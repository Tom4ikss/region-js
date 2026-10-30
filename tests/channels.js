// d8 --harmony-regions --module channels.js
// Channels between threads: values sent into a channel move their regions,
// share frozen ones and copy plain data.
const expectError = (name, fn) => {
  try {
    fn();
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};

// Buffered channel on one thread.
{
  const ch = new Channel(2);
  await ch.send(1);
  await ch.send({ text: 'copied' });
  print('capacity:', ch.capacity, 'size:', ch.size);
  print('recv:', JSON.stringify(await ch.recv()), JSON.stringify(await ch.recv()));
  ch.close();
  print('closed:', ch.closed, 'recv after close:', JSON.stringify(await ch.recv()));
  expectError('send after close', () => ch.send(3));
  expectError('close twice', () => ch.close());
}

expectError('negative capacity', () => new Channel(-1));
expectError('without new', () => Channel());

// A region object moves into the channel and out to whoever receives it.
{
  const ch = new Channel(1);
  const order = new Region().run(() => ({ id: 7, items: ['a', 'b'] }));
  await ch.send(order);
  expectError('sender after send', () => order.id);
  const { value } = await ch.recv();
  value.items[0] = 'z';
  print('received region:', value.id, value.items.join(','), 'owner here:', Region.of(value).owner >= 0);
}

// Unbuffered: the producer task waits for each receive.
{
  const ch = new Channel();
  const producer = spawn(async () => {
    for (let i = 0; i < 5; i++) {
      await ch.send(new Region().run(() => ({ n: i, square: i * i })));
    }
    ch.close();
    return 'producer done';
  });
  const got = [];
  for await (const item of ch) got.push(`${item.n}:${item.square}`);
  print('for await:', got.join(' '), '|', await producer);
}

// Fan-out / fan-in: a pool of tasks takes jobs from one channel and puts
// results into another.
{
  const jobs = new Channel(16);
  const results = new Channel(16);
  const workers = [0, 1, 2, 3].map((w) => spawn(async () => {
    let handled = 0;
    for await (const job of jobs) {
      let sum = 0;
      for (let i = 0; i < job.size; i++) sum += i;
      await results.send({ id: job.id, sum });
      handled++;
    }
    return handled;
  }));
  for (let id = 0; id < 20; id++) await jobs.send({ id, size: 1000 * (id + 1) });
  jobs.close();
  const sums = [];
  for (let i = 0; i < 20; i++) {
    const { value } = await results.recv();
    sums[value.id] = value.sum;
  }
  const handled = await Promise.all(workers);
  print('fan-in ok:', sums.every((s, id) => s === (1000 * (id + 1)) * (1000 * (id + 1) - 1) / 2),
        'jobs handled:', handled.reduce((a, b) => a + b, 0));
}

// select waits for whichever channel is ready first.
{
  const fast = new Channel(1);
  const slow = new Channel(1);
  const task = spawn(async () => { await fast.send('fast'); });
  const first = await Channel.select([slow, fast]);
  print('select:', first.channel === fast, first.value, first.done);
  await task;
  slow.close();
  const closed = await Channel.select([slow]);
  print('select closed:', closed.channel === slow, closed.done);
}

// A frozen region is shared through a channel, not moved.
{
  const region = new Region();
  const config = region.run(() => ({ name: 'prod', limits: [1, 2] }));
  region.freeze();
  const ch = new Channel(1);
  const reader = spawn(async () => {
    const { value } = await ch.recv();
    // Not captured by the task, so not borrowed for it: borrow to read.
    using borrow = Region.of(value).borrow();
    return value.name + ' ' + value.limits[1];
  });
  await ch.send(config);
  print('frozen through channel:', await reader, '| main still reads:', config.name);
  region.thaw();
}

// Blocking receive in a plain worker; the channel itself is sent with
// postMessage.
{
  const ch = new Channel();
  const done = new Channel(1);
  const w = new Worker(`
    onmessage = ({ data }) => {
      let total = 0;
      for (const n of data.ch) total += n;
      data.done.sendSync(total);
    };`, { type: 'string' });
  w.postMessage({ ch, done });
  for (let i = 1; i <= 10; i++) await ch.send(i);
  ch.close();
  print('worker sum:', done.recvSync().value);
  w.terminate();
}

// A channel can travel through a channel.
{
  const outer = new Channel(1);
  const reply = new Channel(1);
  const task = spawn(async () => {
    const { value: back } = await outer.recv();
    await back.send('pong');
  });
  await outer.send(reply);
  print('channel through channel:', (await reply.recv()).value);
  await task;
}

// Terminating a worker that waits on a channel: its blocked receive returns,
// and a value that was not read yet goes back to the channel.
{
  const ch = new Channel();
  const blocked = new Worker(`onmessage = ({ data }) => {
      postMessage('waiting');
      data.ch.recvSync();
    };`, { type: 'string' });
  const awaiting = new Worker(`onmessage = async ({ data }) => {
      postMessage('waiting');
      await data.ch.recv();
    };`, { type: 'string' });
  for (const w of [blocked, awaiting]) {
    w.postMessage({ ch });
    w.getMessage();
    w.terminate();
  }
  const sent = ch.send(new Region().run(() => ({ n: 42 })));
  print('value kept after receivers were terminated:', ch.recvSync().value.n);
  await sent;
}

// Channels inside region data are rejected.
expectError('channel in a region', () => new Region().run(() => ({ ch: new Channel() })));
print('done');

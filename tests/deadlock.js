// d8 --harmony-regions --module deadlock.js
// When every thread waits and none can wake the others, the channel and lock
// waits fail with DeadlockError instead of hanging forever.
const outcome = async (promise) => {
  try {
    return 'value ' + JSON.stringify(await promise);
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};

// The main thread alone waits for a channel nobody else has.
{
  const ch = new Channel(1);
  const start = performance.now();
  print('main recv:', await outcome(ch.recv()));
  print('detected quickly:', performance.now() - start < 1000);
  // The channel still works.
  await ch.send(1);
  print('channel after:', (await ch.recv()).value);
}

// A blocking wait on the main thread.
{
  const ch = new Channel();
  try {
    ch.recvSync();
  } catch (e) {
    print('main recvSync:', e.name);
  }
}

// Two tasks wait for each other.
{
  const a = new Channel();
  const b = new Channel();
  const first = spawn(async (a, b) => {
    await a.recv();
    await b.send('from first');
  }, a, b);
  const second = spawn((a, b) => {
    b.recvSync();
    a.sendSync('from second');
  }, a, b);
  print('task waiting on a:', await outcome(first));
  print('task waiting on b:', await outcome(second));
}

// join() on a task that waits for the main thread.
{
  const ch = new Channel();
  const task = spawn((ch) => ch.recvSync(), ch);
  try {
    task.join();
  } catch (e) {
    print('join:', e.name);
  }
}

// Two locks taken in opposite order.
{
  const left = new RwLock({ n: 0 });
  const right = new RwLock({ n: 0 });
  const ready = new Channel(2);
  const go = new Channel(2);
  const take = (first, second, ready, go) => {
    using a = first.writeSync();
    ready.sendSync(true);
    go.recvSync();
    try {
      using b = second.writeSync();
      return 'got both';
    } catch (e) {
      return e.name;
    }
  };
  const one = spawn(take, left, right, ready, go);
  const two = spawn(take, right, left, ready, go);
  await ready.recv();
  await ready.recv();
  await go.send(true);
  await go.send(true);
  print('opposite lock order:', await outcome(one), await outcome(two));
  // Both guards were released when the tasks ended.
  using l = left.tryWrite();
  using r = right.tryWrite();
  print('locks free after:', l !== null, r !== null);
}

// Not a deadlock: a thread that is still working will send.
{
  const ch = new Channel();
  const task = spawn((ch) => {
    const end = performance.now() + 300;
    while (performance.now() < end);
    ch.sendSync('late but fine');
  }, ch);
  print('busy sender:', await outcome(ch.recv().then((r) => r.value)));
  await task;
}

// Not a deadlock: a timeout will abort the task.
{
  const ch = new Channel();
  const task = spawn(async (ch) => {
    await ch.recv();
  }, ch).timeout(300);
  print('pending timeout:', await outcome(task));
}

// A task that catches the error can go on.
{
  const ch = new Channel();
  const task = spawn(async (ch) => {
    try {
      await ch.recv();
    } catch (e) {
      return 'caught ' + e.name;
    }
  }, ch);
  print('caught in task:', await outcome(task));
}

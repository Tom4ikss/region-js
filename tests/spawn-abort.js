// d8 --harmony-regions --module spawn-abort.js
// handle.abort(), handle.timeout(ms) and JoinSet.
const outcome = async (handle) => {
  try {
    return 'value ' + JSON.stringify(await handle);
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};
const busy = (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

// A task that has not started never runs; the region it captured comes back.
{
  spawn.poolSize = 1;
  const blocker = spawn(() => {
    const end = performance.now() + 200;
    while (performance.now() < end);
    return 'blocker done';
  });
  const data = new Region().run(() => ({ items: [1, 2, 3] }));
  const queued = spawn(() => data.items.length);
  const start = performance.now();
  queued.abort();
  print('queued:', await outcome(queued), '| before the blocker ended:',
        performance.now() - start < 150);
  print('region is back:', data.items.length, '|', await outcome(blocker));
}

// A running task waiting on a channel: the wait fails.
spawn.poolSize = 4;
{
  const never = new Channel();
  const task = spawn(async (never) => {
    await never.recv();
    return 'got a value';
  }, never);
  busy(20);
  task.abort();
  print('waiting on recv:', await outcome(task));
}

// Blocking waits are interrupted too.
{
  const never = new Channel();
  const task = spawn((never) => never.recvSync(), never);
  busy(20);
  task.abort();
  print('blocked in recvSync:', await outcome(task));
}

// Waiting for a lock; the lock keeps working.
{
  const lock = new RwLock({ n: 0 });
  const held = await lock.write();
  const task = spawn(async (lock) => {
    using g = await lock.write();
    g.value.n = 99;
  }, lock);
  busy(20);
  task.abort();
  print('waiting for a lock:', await outcome(task));
  held.value.n = 1;
  held.release();
  using r = await lock.read();
  print('lock after:', r.value.n);
}

// A task that holds a guard and is aborted gives the lock back.
{
  const lock = new RwLock({ n: 0 });
  const never = new Channel();
  const task = spawn(async (lock, never) => {
    using g = await lock.write();
    g.value.n = 5;
    await never.recv();
  }, lock, never);
  busy(30);
  task.abort();
  print('aborted while holding:', await outcome(task));
  using r = await lock.read();
  print('lock released:', r.value.n);
}

// Code that waits on nothing checks spawn.aborted().
{
  const task = spawn(() => {
    let rounds = 0;
    while (!spawn.aborted()) rounds++;
    return rounds;
  });
  busy(20);
  task.abort();
  print('busy loop:', await outcome(task));
  print('main thread:', spawn.aborted());
}

// A task that catches the error still ends aborted; later waits fail too.
{
  const never = new Channel();
  const task = spawn(async (never) => {
    try {
      await never.recv();
    } catch {
      // ignored
    }
    try {
      await never.recv();
    } catch (e) {
      return 'second wait: ' + e.name;
    }
  }, never);
  busy(20);
  task.abort();
  print('caught:', await outcome(task));
}

// Finished tasks are not affected.
{
  const task = spawn(() => 42);
  print('finished:', await outcome(task));
  task.abort();
  print('after abort:', await outcome(task));
}

// timeout(ms)
{
  const never = new Channel();
  const start = performance.now();
  const slow = spawn(async (never) => {
    await never.recv();
  }, never).timeout(50);
  const result = await outcome(slow);
  const took = performance.now() - start;
  print('timeout:', result, '| after about 50 ms:', took >= 45 && took < 1000);
  print('in time:', await outcome(spawn(() => 'quick').timeout(5000)));
  // join() blocks the main thread; the timeout still fires.
  const blocked = spawn((never) => never.recvSync(), never).timeout(30);
  try {
    blocked.join();
  } catch (e) {
    print('join with timeout:', e.name);
  }
  print('bad timeout:', (() => {
    try {
      spawn(() => 1).timeout(-1);
    } catch (e) {
      return e.name;
    }
  })());
}

// JoinSet: results in the order tasks finish.
{
  const set = new JoinSet();
  for (const ms of [150, 10, 90]) {
    set.spawn((ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
      return ms;
    }, ms);
  }
  set.spawn(() => {
    const end = performance.now() + 50;
    while (performance.now() < end);
    throw new RangeError('bad task');
  });
  print('set size:', set.size);
  const order = [];
  for await (const result of set) {
    order.push(result.status === 'fulfilled' ? result.value : result.reason.name);
  }
  print('finished in order:', order.join(', '), '| empty:', set.size,
        await set.next());
}
{
  const never = new Channel();
  let set;
  {
    using tasks = new JoinSet();
    set = tasks;
    tasks.spawn(() => 'fast');
    tasks.spawn(async (never) => {
      await never.recv();
    }, never);
    busy(20);
  }
  const results = [];
  for await (const result of set) {
    results.push(result.status === 'fulfilled' ? result.value : result.reason.name);
  }
  print('using JoinSet:', results.sort().join(', '));
}

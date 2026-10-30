// d8 --harmony-regions --module spawn-pool.js
// The pool's workers take tasks from one queue: a task waits only while every
// worker is busy, never behind a long task while another worker is free. A
// worker that exits fails only the tasks it took.
const busy = (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
  return ms;
};

// Short tasks do not wait for a long one.
{
  spawn.poolSize = 4;
  const start = performance.now();
  const long = spawn(() => busy(500));
  const shorts = await Promise.all(Array.from({ length: 8 }, (_, i) => spawn((i) => i * i, i)));
  const shortTime = performance.now() - start;
  await long;
  print('short tasks:', shorts.join(','), 'done before the long one:', shortTime < 300);
}

// More tasks than workers: all of them run, spread over the workers.
{
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => spawn((i) => {
    busy(5);
    return i;
  }, i)));
  print('40 tasks on 4 workers:', results.reduce((a, b) => a + b, 0));
}

// A worker exits in the middle of a task: that task fails, the others are
// done by the other workers, and the pool keeps working.
{
  spawn.poolSize = 3;
  const tasks = [
    spawn(async () => {
      await null;
      globalThis.close();
      await new Promise(() => {});
    }),
    ...Array.from({ length: 12 }, (_, i) => spawn((i) => {
      busy(10);
      return i;
    }, i)),
  ];
  const settled = await Promise.allSettled(tasks);
  print('one worker exited:', settled.map((r) => r.status === 'fulfilled' ? r.value : r.reason.message).join(' | '));
  print('after it:', (await Promise.all([1, 2, 3].map((i) => spawn((i) => i * 10, i)))).join(','));
}

// Every worker exits: their tasks fail, the next spawn starts a new pool.
{
  spawn.poolSize = 1;
  const handle = spawn(() => {
    globalThis.close();
    return 'never';
  });
  try {
    handle.join();
  } catch (e) {
    print('join:', e.message);
  }
  print('new pool:', await spawn((x) => x + 1, 1), await spawn(() => 'fresh'));
}

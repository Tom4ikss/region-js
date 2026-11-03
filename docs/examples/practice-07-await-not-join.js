// Practice 7. On the main thread, wait for a task with await, not join().
// While the task computes (~0.2 s), the main thread runs a setTimeout chain, as if it
// were handling clicks and frames. We count how many times it managed to respond and
// how long the longest pause was. In d8, setTimeout does not wait for the given delay,
// so the chain spins as fast as the thread allows.
const heavy = (n) => {
  let t = 0;
  for (let i = 0; i < n; i++) t = (t + i * i) % 1000003;
  return t;
};
const N = 30_000_000;

const watchMainThread = (label, wait) => new Promise((resolve) => {
  let ticks = 0, longest = 0, last = performance.now(), running = true;
  const tick = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    ticks++;
    if (running) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  const start = performance.now();
  wait().then(() => {
    running = false;
    const total = performance.now() - start;
    setTimeout(() => {
      print(`${label}: task ${total.toFixed(0)} ms, the main thread responded ${ticks} times, ` +
        `longest pause ${longest.toFixed(1)} ms`);
      resolve();
    }, 0);
  });
});

(async () => {
  // Bad: join() stops the main thread until the task ends.
  await watchMainThread('join ', async () => {
    spawn(heavy, N).join();
  });
  // Good: await releases the thread while the task computes in a worker.
  await watchMainThread('await', async () => {
    await spawn(heavy, N);
  });
})();

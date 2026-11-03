// Практика 7. В главном потоке ждать задачу через await, а не join().
// Пока задача считается (~0,2 с), главный поток гоняет цепочку setTimeout — как будто
// обрабатывает клики и кадры. Считаем, сколько раз он успел отреагировать и
// какой была самая длинная пауза. В d8 setTimeout не ждёт указанную задержку,
// поэтому цепочка крутится так быстро, как позволяет поток.
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
      print(`${label}: задача ${total.toFixed(0)} ms, главный поток ответил ${ticks} раз, ` +
        `самая длинная пауза ${longest.toFixed(1)} ms`);
      resolve();
    }, 0);
  });
});

(async () => {
  // Плохо: join() останавливает главный поток до конца задачи.
  await watchMainThread('join ', async () => {
    spawn(heavy, N).join();
  });
  // Хорошо: await отпускает поток, пока задача считается в воркере.
  await watchMainThread('await', async () => {
    await spawn(heavy, N);
  });
})();

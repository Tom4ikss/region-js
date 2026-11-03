// What the spawn call itself costs: the task does almost nothing.
print('workers in the pool:', spawn.poolSize);
for (let i = 0; i < 200; i++) spawn((x) => x, i).join(); // warm-up: the pool is created on the first spawn

const N = 100_000;
let start = performance.now();
for (let i = 0; i < N; i++) spawn((x) => x + 1, i).join();
let ms = performance.now() - start;
print(`${N} tasks one after another (join): ${ms.toFixed(0)} ms, ${((ms * 1000) / N).toFixed(0)} µs per task`);

(async () => {
  const M = 20_000;
  start = performance.now();
  const results = await Promise.all(Array.from({ length: M }, (_, i) => spawn((x) => x + 1, i)));
  ms = performance.now() - start;
  print(`${M} tasks at once (await): ${ms.toFixed(0)} ms, last result ${results[M - 1]}`);
})();

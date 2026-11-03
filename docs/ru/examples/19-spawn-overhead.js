// Сколько стоит сам запуск spawn: задача почти ничего не делает.
print('воркеров в пуле:', spawn.poolSize);
for (let i = 0; i < 200; i++) spawn((x) => x, i).join(); // прогрев: пул создаётся при первом spawn

const N = 100_000;
let start = performance.now();
for (let i = 0; i < N; i++) spawn((x) => x + 1, i).join();
let ms = performance.now() - start;
print(`${N} задач по очереди (join): ${ms.toFixed(0)} ms, ${((ms * 1000) / N).toFixed(0)} µs на задачу`);

(async () => {
  const M = 20_000;
  start = performance.now();
  const results = await Promise.all(Array.from({ length: M }, (_, i) => spawn((x) => x + 1, i)));
  ms = performance.now() - start;
  print(`${M} задач сразу (await): ${ms.toFixed(0)} ms, последний результат ${results[M - 1]}`);
})();

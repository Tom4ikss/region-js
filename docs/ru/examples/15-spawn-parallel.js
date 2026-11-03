// Четыре тяжёлые задачи: по очереди и все сразу.
const heavy = (n) => {
  let t = 0;
  for (let i = 0; i < n; i++) t = (t + i * i) % 1000003;
  return t;
};
const N = 20_000_000;

let start = performance.now();
const one = [0, 1, 2, 3].map(() => spawn(heavy, N).join()); // ждём каждую сразу
const sequentialMs = performance.now() - start;

start = performance.now();
const tasks = [0, 1, 2, 3].map(() => spawn(heavy, N)); // сначала запускаем все
const all = tasks.map((t) => t.join());                 // потом ждём
const parallelMs = performance.now() - start;

print('результаты совпадают:', all.every((v) => v === one[0]));
print(`по очереди: ${sequentialMs.toFixed(0)} ms`);
print(`все сразу:  ${parallelMs.toFixed(0)} ms (x${(sequentialMs / parallelMs).toFixed(1)})`);

// Шесть задач: с пулом из четырёх воркеров две ждут очереди, с пулом из шести — нет.
const six = (label) => {
  start = performance.now();
  [0, 1, 2, 3, 4, 5].map(() => spawn(heavy, N)).forEach((t) => t.join());
  print(`6 задач, ${label}: ${(performance.now() - start).toFixed(0)} ms`);
};
six('пул из 4');
spawn.poolSize = 6;
six('пул из 6');

// Four heavy tasks: one after another and all at once.
const heavy = (n) => {
  let t = 0;
  for (let i = 0; i < n; i++) t = (t + i * i) % 1000003;
  return t;
};
const N = 20_000_000;

let start = performance.now();
const one = [0, 1, 2, 3].map(() => spawn(heavy, N).join()); // wait for each one right away
const sequentialMs = performance.now() - start;

start = performance.now();
const tasks = [0, 1, 2, 3].map(() => spawn(heavy, N)); // start them all first
const all = tasks.map((t) => t.join());                 // then wait
const parallelMs = performance.now() - start;

print('results match:', all.every((v) => v === one[0]));
print(`one after another: ${sequentialMs.toFixed(0)} ms`);
print(`all at once:       ${parallelMs.toFixed(0)} ms (x${(sequentialMs / parallelMs).toFixed(1)})`);

// Six tasks: with a pool of four workers two wait in the queue, with a pool of six none do.
const six = (label) => {
  start = performance.now();
  [0, 1, 2, 3, 4, 5].map(() => spawn(heavy, N)).forEach((t) => t.join());
  print(`6 tasks, ${label}: ${(performance.now() - start).toFixed(0)} ms`);
};
six('pool of 4');
spawn.poolSize = 6;
six('pool of 6');

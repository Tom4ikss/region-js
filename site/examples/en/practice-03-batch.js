// Practice 3. A few large tasks instead of thousands of small ones.
// Count the primes below 2,000,000 in four ways.
const LIMIT = 2_000_000;
const isPrime = (n) => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};
const countPrimes = (from, to) => {
  let count = 0;
  for (let n = from; n < to; n++) if (isPrime(n)) count++;
  return count;
};

const split = (parts) =>
  Array.from({ length: parts }, (_, i) =>
    spawn(countPrimes, Math.floor((LIMIT * i) / parts), Math.floor((LIMIT * (i + 1)) / parts)));
const measure = async (label, run) => {
  let best = Infinity, result = 0;
  for (let rep = 0; rep < 3; rep++) {
    const t = performance.now();
    result = await run();
    best = Math.min(best, performance.now() - t);
  }
  print(`${label}: ${best.toFixed(0)} ms (primes: ${result})`);
};
const sum = (list) => list.reduce((a, b) => a + b, 0);

(async () => {
  print('workers in the pool:', spawn.poolSize);
  await measure('on the main thread   ', async () => countPrimes(0, LIMIT));
  await measure('10,000 small tasks   ', async () => sum(await Promise.all(split(10_000))));
  await measure('100 medium tasks     ', async () => sum(await Promise.all(split(100))));
  await measure(`${spawn.poolSize} large tasks        `, async () => sum(await Promise.all(split(spawn.poolSize))));
})();

// Practice 4. Hot loops: compute in local variables and write to the region once.
const region = new Region();
const stats = region.run(() => ({ count: 0, sum: 0 }));
const prices = region.run(() => Array.from({ length: 100_000 }, (_, i) => i % 100));
const values = Array.from({ length: 1_000_000 }, (_, i) => i % 7);

// a) Writes. Bad: write to the region object on every step.
const writeEachStep = () => {
  for (let i = 0; i < values.length; i++) {
    stats.count += 1;
    stats.sum += values[i];
  }
};
// Good: compute locally, write the result to the region.
const writeOnce = () => {
  let count = stats.count, sum = stats.sum;
  for (let i = 0; i < values.length; i++) {
    count += 1;
    sum += values[i];
  }
  stats.count = count;
  stats.sum = sum;
};

// b) Many reads by index. Bad: 50 passes directly over the region array.
const PASSES = 50;
const readRegion = () => {
  let total = 0;
  for (let p = 0; p < PASSES; p++)
    for (let i = 0; i < prices.length; i++) total += prices[i];
  return total;
};
// Good: copy it once into a plain array with a simple loop (the copy is part of the measurement).
const sumLocal = (local) => {
  let total = 0;
  for (let p = 0; p < PASSES; p++)
    for (let i = 0; i < local.length; i++) total += local[i];
  return total;
};
const readLoopCopy = () => {
  const local = new Array(prices.length);
  for (let i = 0; i < prices.length; i++) local[i] = prices[i];
  return sumLocal(local);
};
// Array.from (and spread) copy just as fast: for a region array it is one pass over the values.
const sumFromCopy = (local) => {
  let total = 0;
  for (let p = 0; p < PASSES; p++)
    for (let i = 0; i < local.length; i++) total += local[i];
  return total;
};
const readArrayFrom = () => sumFromCopy(Array.from(prices));

const best = (fn) => {
  let min = Infinity;
  for (let rep = 0; rep < 7; rep++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return min.toFixed(2);
};
print(`writes: to the region on every step ${best(writeEachStep)} ms, locally and once ${best(writeOnce)} ms`);
print(`reads: over the region array ${best(readRegion)} ms, loop copy + plain array ${best(readLoopCopy)} ms, ` +
  `Array.from copy + plain array ${best(readArrayFrom)} ms`);
print('results match:', readRegion() === readLoopCopy() && readLoopCopy() === readArrayFrom());

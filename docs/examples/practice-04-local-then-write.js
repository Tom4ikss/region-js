// Практика 4. Горячие циклы: считать в локальных переменных, а в регион писать один раз.
const region = new Region();
const stats = region.run(() => ({ count: 0, sum: 0 }));
const prices = region.run(() => Array.from({ length: 100_000 }, (_, i) => i % 100));
const values = Array.from({ length: 1_000_000 }, (_, i) => i % 7);

// а) запись. Плохо: пишем в объект региона на каждом шаге.
const writeEachStep = () => {
  for (let i = 0; i < values.length; i++) {
    stats.count += 1;
    stats.sum += values[i];
  }
};
// Хорошо: считаем локально, в регион пишем результат.
const writeOnce = () => {
  let count = stats.count, sum = stats.sum;
  for (let i = 0; i < values.length; i++) {
    count += 1;
    sum += values[i];
  }
  stats.count = count;
  stats.sum = sum;
};

// б) чтение по индексу много раз. Плохо: 50 проходов прямо по массиву региона.
const PASSES = 50;
const readRegion = () => {
  let total = 0;
  for (let p = 0; p < PASSES; p++)
    for (let i = 0; i < prices.length; i++) total += prices[i];
  return total;
};
// Хорошо: один раз скопировать в обычный массив простым циклом (копия входит в замер).
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
// А Array.from (и spread) на массиве региона пока медленные: они идут через итератор.
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
print(`запись: в регион на каждом шаге ${best(writeEachStep)} ms, локально и один раз ${best(writeOnce)} ms`);
print(`чтение: по массиву региона ${best(readRegion)} ms, копия циклом + обычный массив ${best(readLoopCopy)} ms, ` +
  `копия Array.from + обычный массив ${best(readArrayFrom)} ms`);
print('результаты совпадают:', readRegion() === readLoopCopy() && readLoopCopy() === readArrayFrom());

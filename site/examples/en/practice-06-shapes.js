// Practice 6. The same shape for all objects: the same keys in the same order.
// The sum of the field x over 100,000 region objects, 20 passes.
const N = 100_000;
const PASSES = 20;
const KEYS = ['x', 'y', 'z', 'w'];
const permutations = (list) =>
  list.length <= 1 ? [list] : list.flatMap((k, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [k, ...p]));
const ORDERS = permutations(KEYS); // 24 key orders

// shapes is how many different key orders occur in the array.
const make = (shapes) => Array.from({ length: N }, (_, i) => {
  const o = {};
  for (const key of ORDERS[i % shapes]) o[key] = i;
  return o;
});
// Each measurement gets its own copy of the function (new Function with a unique comment,
// otherwise the engine takes it from the cache), so that inline cache feedback does not mix.
let copies = 0;
const makeSumX = () => new Function('list', `// copy ${++copies}
  let total = 0;
  for (let p = 0; p < ${PASSES}; p++)
    for (let i = 0; i < list.length; i++) total += list[i].x;
  return total;
`);

const best = (list) => {
  const sumX = makeSumX();
  let min = Infinity;
  for (let rep = 0; rep < 5; rep++) {
    const t = performance.now();
    sumX(list);
    min = Math.min(min, performance.now() - t);
  }
  return min.toFixed(1).padStart(6);
};
for (const shapes of [1, 4, 24]) {
  const region = new Region();
  const inRegion = region.run(() => make(shapes));
  const plain = make(shapes);
  print(`different shapes ${String(shapes).padStart(2)}: region ${best(inRegion)} ms | plain objects ${best(plain)} ms`);
}

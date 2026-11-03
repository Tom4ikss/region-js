// Practice 1. Large read-only data: a frozen region instead of a plain array.
// 32 tasks read a catalog of 100,000 products, each its own part.
const N = 100_000;
const TASKS = 32;
const makeCatalog = () => Array.from({ length: N }, (_, i) => ({ id: i, price: i % 100 }));

const plainCatalog = makeCatalog();
const region = new Region();
const frozenCatalog = region.run(makeCatalog);
region.freeze();

// Bad: the plain array is captured, and spawn copies it into every task.
const sumPlain = (part) => spawn((k) => {
  let sum = 0;
  for (let i = k; i < plainCatalog.length; i += TASKS) sum += plainCatalog[i].price;
  return sum;
}, part);

// Good: the frozen region is shared, all tasks read the same objects.
const sumFrozen = (part) => spawn((k) => {
  let sum = 0;
  for (let i = k; i < frozenCatalog.length; i += TASKS) sum += frozenCatalog[i].price;
  return sum;
}, part);

const parts = Array.from({ length: TASKS }, (_, k) => k);
const measure = async (label, start) => {
  let best = Infinity, total = 0;
  for (let rep = 0; rep < 3; rep++) {
    const t = performance.now();
    total = (await Promise.all(parts.map(start))).reduce((a, b) => a + b, 0);
    best = Math.min(best, performance.now() - t);
  }
  print(`${label}: ${best.toFixed(1)} ms (sum ${total})`);
};

(async () => {
  await measure('plain array, captured', sumPlain);
  await measure('frozen region        ', sumFrozen);
})();

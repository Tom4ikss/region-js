// Практика 1. Большие данные только для чтения: замороженный регион вместо обычного массива.
// 32 задачи читают каталог из 100 000 товаров, каждая свою часть.
const N = 100_000;
const TASKS = 32;
const makeCatalog = () => Array.from({ length: N }, (_, i) => ({ id: i, price: i % 100 }));

const plainCatalog = makeCatalog();
const region = new Region();
const frozenCatalog = region.run(makeCatalog);
region.freeze();

// Плохо: обычный массив захватывается, и spawn копирует его в каждую задачу.
const sumPlain = (part) => spawn((k) => {
  let sum = 0;
  for (let i = k; i < plainCatalog.length; i += TASKS) sum += plainCatalog[i].price;
  return sum;
}, part);

// Хорошо: замороженный регион общий, задачи читают одни и те же объекты.
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
  print(`${label}: ${best.toFixed(1)} ms (сумма ${total})`);
};

(async () => {
  await measure('обычный массив, захват', sumPlain);
  await measure('замороженный регион   ', sumFrozen);
})();

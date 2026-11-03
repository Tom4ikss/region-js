// Практика 2. Создать регион один раз и гонять его туда-обратно, а не пересоздавать.
// 200 раз отправляем воркеру 10 000 объектов, он меняет один и возвращает.
const N = 10_000;
const ROUNDS = 200;
const worker = new Worker(
  `onmessage = ({ data: { items } }) => {
     items[0].x += 1;
     postMessage({ items }, [Region.of(items)]);
   };`,
  { type: 'string' },
);
const local = Array.from({ length: N }, (_, i) => ({ x: i, y: -i }));

// Плохо: каждый раз новый регион. run копирует все 10 000 объектов, O(n).
const rebuild = () => {
  for (let r = 0; r < ROUNDS; r++) {
    const region = new Region();
    const items = region.run(() => local);
    worker.postMessage({ items }, [region]);
    worker.getMessage();
  }
};

// Хорошо: регион создан один раз, дальше только переезды, O(1).
const region = new Region();
let items = region.run(() => local);
const move = () => {
  for (let r = 0; r < ROUNDS; r++) {
    worker.postMessage({ items }, [Region.of(items)]);
    items = worker.getMessage().items;
  }
};

const best = (fn) => {
  let min = Infinity;
  for (let rep = 0; rep < 3; rep++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return (min / ROUNDS) * 1000;
};
print(`пересоздавать регион: ${best(rebuild).toFixed(1)} µs за круг`);
print(`переезд туда-обратно: ${best(move).toFixed(1)} µs за круг`);
print('items[0].x после всех кругов:', items[0].x);
worker.terminate();

// Practice 2. Create a region once and move it back and forth instead of rebuilding it.
// 200 times we send 10,000 objects to a worker; it changes one and sends them back.
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

// Bad: a new region every time. run copies all 10,000 objects, O(n).
const rebuild = () => {
  for (let r = 0; r < ROUNDS; r++) {
    const region = new Region();
    const items = region.run(() => local);
    worker.postMessage({ items }, [region]);
    worker.getMessage();
  }
};

// Good: the region is created once, after that only moves, O(1).
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
print(`rebuild the region:  ${best(rebuild).toFixed(1)} µs per round trip`);
print(`move back and forth: ${best(move).toFixed(1)} µs per round trip`);
print('items[0].x after all round trips:', items[0].x);
worker.terminate();

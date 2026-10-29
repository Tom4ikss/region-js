// d8 --harmony-regions hot-ownership.js
const build = (depth) =>
  depth === 0
    ? { value: 1, left: null, right: null }
    : { value: 1, left: build(depth - 1), right: build(depth - 1) };
const sum = (node) => node.value + (node.left ? sum(node.left) : 0) + (node.right ? sum(node.right) : 0);
const length = (array) => array.length;

const region = new Region();
const tree = region.run(() => build(10));
const list = region.run(() => [1, 2, 3]);

// Warm up the same IC sites, including optimized code.
let total = 0;
for (let i = 0; i < 2000; i++) total += sum(tree) + length(list);
print('warm sum ok:', total === 2000 * (2047 + 3));

const w = new Worker(`onmessage = ({ data }) => postMessage(data.tree.value)`, { type: 'string' });
w.postMessage({ tree, list }, [region]);
print('worker read:', w.getMessage());

for (const [name, fn] of [['sum', () => sum(tree)], ['length', () => length(list)]]) {
  try {
    fn();
    print(`${name}: NO ERROR — ownership check missed`);
  } catch (e) {
    print(`${name} after move:`, e.message);
  }
}
w.terminate();

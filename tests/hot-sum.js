// d8 --harmony-regions hot-sum.js
const build = (depth) =>
  depth === 0
    ? { value: 1, left: null, right: null }
    : { value: 1, left: build(depth - 1), right: build(depth - 1) };
const sum = (node) => node.value + (node.left ? sum(node.left) : 0) + (node.right ? sum(node.right) : 0);

const region = new Region();
const tree = region.run(() => build(16));
let total = 0;
const start = performance.now();
for (let i = 0; i < 20; i++) total += sum(tree);
print(`${(performance.now() - start).toFixed(1)} ms, total ${total}`);

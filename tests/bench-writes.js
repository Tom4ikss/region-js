// d8 --harmony-regions bench-writes.js
const build = (depth) =>
  depth === 0
    ? { value: 1, left: null, right: null }
    : { value: 1, left: build(depth - 1), right: build(depth - 1) };
const bump = (node) => {
  node.value = node.value + 1;
  if (node.left) bump(node.left);
  if (node.right) bump(node.right);
};
const sumArray = (array) => {
  let total = 0;
  for (let i = 0; i < array.length; i++) total += array[i];
  return total;
};

function fastest(runs, fn) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

const report = (name, plainMs, regionMs) =>
  print(`${name}: plain ${plainMs.toFixed(3)} ms, region ${regionMs.toFixed(3)} ms (x${(regionMs / plainMs).toFixed(1)})`);

const plainTree = build(19);
const regionTree = new Region().run(() => build(19));
report('write every node of 1M tree', fastest(5, () => bump(plainTree)), fastest(5, () => bump(regionTree)));

const plainArray = Array.from({ length: 1_000_000 }, (_, i) => i);
const regionArray = new Region().run(() => plainArray);
report('sum 1M array by index', fastest(5, () => sumArray(plainArray)), fastest(5, () => sumArray(regionArray)));
print('array sums equal:', sumArray(plainArray) === sumArray(regionArray));

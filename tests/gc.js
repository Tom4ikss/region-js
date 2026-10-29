// d8 --harmony-regions --verify-heap --expose-gc gc.js
const region = new Region();
const tree = region.run(() => {
  const build = (depth) =>
    depth === 0 ? { value: 1, label: 'leaf' } : { value: 1, left: build(depth - 1), right: build(depth - 1) };
  return build(14);
});
gc();

const sum = (node) => node.value + (node.left ? sum(node.left) : 0) + (node.right ? sum(node.right) : 0);
print('main sum before move:', sum(tree));

const w = new Worker(
  `
  const sum = (node) => node.value + (node.left ? sum(node.left) : 0) + (node.right ? sum(node.right) : 0);
  onmessage = ({ data }) => {
    gc();
    const before = sum(data.tree);
    gc();
    postMessage([before, sum(data.tree), data.tree.left.left.label === undefined]);
  };
  `,
  { type: 'string' },
);
w.postMessage({ tree }, [region]);
gc();
print('worker sums:', w.getMessage());
gc();
w.terminate();

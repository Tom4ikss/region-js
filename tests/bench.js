// d8 --harmony-regions bench.js
const build = (depth) =>
  depth === 0
    ? { value: 1, left: null, right: null }
    : { value: 1, left: build(depth - 1), right: build(depth - 1) };
const sum = (node) => node.value + (node.left ? sum(node.left) : 0) + (node.right ? sum(node.right) : 0);

function time(fn) {
  const start = performance.now();
  const result = fn();
  return [performance.now() - start, result];
}

function fastest(runs, fn) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) best = Math.min(best, time(fn)[0]);
  return best;
}

const ms = (value) => `${value.toFixed(3)} ms`;
const worker = new Worker(`onmessage = () => postMessage(0)`, { type: 'string' });
const roundTrip = (message, transfer) => time(() => {
  worker.postMessage(message, transfer);
  worker.getMessage();
})[0];

for (const depth of [9, 19]) {
  const nodes = 2 ** (depth + 1) - 1;
  const plain = build(depth);
  print(`\n== tree with ${nodes} nodes`);

  const region = new Region();
  const [createMs, tree] = time(() => region.run(() => plain));
  print(`region.run (copy into region): ${ms(createMs)}`);

  const cloneMs = Math.min(...[0, 1, 2].map(() => roundTrip({ tree: plain })));
  print(`postMessage, structured clone: ${ms(cloneMs)}`);

  const plainSumMs = fastest(5, () => sum(plain));
  const regionSumMs = fastest(5, () => sum(tree));
  print(`sum, plain objects:  ${ms(plainSumMs)}`);
  print(`sum, region objects: ${ms(regionSumMs)} (x${(regionSumMs / plainSumMs).toFixed(1)})`);

  const moveMs = roundTrip({ tree }, [region]);
  print(`postMessage, region move:      ${ms(moveMs)}`);
}
worker.terminate();

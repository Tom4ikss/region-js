// d8 --harmony-regions bench-frozen.js
const build = (depth) =>
  depth === 0
    ? { value: 1, left: null, right: null }
    : { value: 1, left: build(depth - 1), right: build(depth - 1) };
const sum = (node) => node.value + (node.left ? sum(node.left) : 0) + (node.right ? sum(node.right) : 0);

const DEPTH = 19;
const PASSES = 8;
const region = new Region();
const tree = region.run(() => build(DEPTH));
region.freeze();

const workerSource = `
  const sum = (node) => node.value + (node.left ? sum(node.left) : 0) + (node.right ? sum(node.right) : 0);
  onmessage = ({ data }) => {
    if (data.tree) { globalThis.tree = data.tree; postMessage(0); return; }
    let total = 0;
    for (let i = 0; i < data.passes; i++) total += sum(globalThis.tree);
    postMessage(total);
  };
`;

for (let i = 0; i < 3; i++) sum(tree);
let start = performance.now();
let expected = 0;
for (let i = 0; i < PASSES; i++) expected += sum(tree);
const singleMs = performance.now() - start;
print(`1 thread, ${PASSES} passes: ${singleMs.toFixed(1)} ms`);

for (const count of [2, 4, 8]) {
  const workers = Array.from({ length: count }, () => new Worker(workerSource, { type: 'string' }));
  for (const w of workers) w.postMessage({ tree });
  for (const w of workers) w.getMessage();
  for (const w of workers) w.postMessage({ passes: 1 }); // warm up
  for (const w of workers) w.getMessage();

  const passes = PASSES / count;
  start = performance.now();
  for (const w of workers) w.postMessage({ passes });
  let total = 0;
  for (const w of workers) total += w.getMessage();
  const ms = performance.now() - start;
  print(`${count} workers, ${passes} passes each: ${ms.toFixed(1)} ms (x${(singleMs / ms).toFixed(1)}), correct: ${total === expected}`);
  for (const w of workers) w.terminate();
}

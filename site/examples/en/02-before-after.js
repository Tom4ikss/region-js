// Before and after: the same tree sent to a worker as a copy and as a "move".
const build = (depth) =>
  depth === 0
    ? { value: 1, left: null, right: null }
    : { value: 1, left: build(depth - 1), right: build(depth - 1) };

const worker = new Worker(
  `onmessage = ({ data }) => postMessage(data.tree.value)`,
  { type: 'string' },
);
const roundTrip = (message, transfer) => {
  const start = performance.now();
  worker.postMessage(message, transfer);
  worker.getMessage();
  return performance.now() - start;
};

const plain = build(16); // 131,071 nodes
print('nodes in the tree:', 2 ** 17 - 1);

// Before: a plain postMessage does a structured clone of the whole tree.
print(`copy (structured clone): ${roundTrip({ tree: plain }).toFixed(2)} ms`);

// After: the tree is in a region, and the region goes in the transfer list.
const region = new Region();
const tree = region.run(() => plain); // one copy when the region is created
print(`region move:             ${roundTrip({ tree }, [region]).toFixed(2)} ms`);

try {
  tree.value;
} catch (e) {
  print('main thread after the move:', String(e));
}
worker.terminate();

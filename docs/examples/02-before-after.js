// До и после: одно и то же дерево отправляем в воркер копией и «переездом».
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

const plain = build(16); // 131 071 узел
print('узлов в дереве:', 2 ** 17 - 1);

// До: обычный postMessage делает structured clone всего дерева.
print(`копия (structured clone): ${roundTrip({ tree: plain }).toFixed(2)} ms`);

// После: дерево лежит в регионе, регион передаётся в transfer list.
const region = new Region();
const tree = region.run(() => plain); // одна копия при создании региона
print(`переезд региона:          ${roundTrip({ tree }, [region]).toFixed(2)} ms`);

try {
  tree.value;
} catch (e) {
  print('главный поток после переезда:', e.message);
}
worker.terminate();

// d8 --harmony-regions --verify-heap --expose-gc hot-writes.js
const region = new Region();
const state = region.run(() => ({ count: 0, label: 'x', child: { n: 1 }, list: [1, 2, 3] }));
const other = region.run(() => ({ n: 2 }));
const foreign = new Region().run(() => ({ n: 3 }));

const setCount = (o, v) => { o.count = v; };
const setLabel = (o, v) => { o.label = v; };
const setChild = (o, v) => { o.child = v; };
const at = (a, i) => a[i];

for (let i = 0; i < 5000; i++) {
  setCount(state, i);
  setLabel(state, 'label');
  setChild(state, state.child);
  at(state.list, i % 3);
}
print('hot count:', state.count, 'element:', at(state.list, 1), 'oob:', at(state.list, 7));

setLabel(state, 'dyn' + Math.random().toString().slice(0, 0) + 'amic'); // local string
setCount(state, 1.5);                                                  // local heap number
setChild(state, other);                                                // same region object
gc();
print('shared via runtime:', state.label, state.count, state.child.n);

for (const [name, value] of [['local object', { n: 4 }], ['foreign region', foreign]]) {
  try {
    setChild(state, value);
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}:`, e.message);
  }
}

const w = new Worker(`onmessage = ({ data }) => postMessage(data.state.count)`, { type: 'string' });
w.postMessage({ state }, [region]);
print('worker read:', w.getMessage());
for (const [name, fn] of [['write', () => setCount(state, 1)], ['element', () => at(state.list, 0)]]) {
  try {
    fn();
    print(`${name} after move: NO ERROR`);
  } catch (e) {
    print(`${name} after move:`, e.message);
  }
}
w.terminate();

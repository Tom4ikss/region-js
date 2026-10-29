// d8 --harmony-regions --verify-heap --expose-gc typed-arrays.js
const expectError = (name, fn) => {
  try {
    const value = fn();
    print(`${name}: no error${value === undefined ? '' : ' -> ' + value}`);
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};

// Copied by default: the original stays usable.
const original = new Float64Array([1, 2, 3]);
const region = new Region();
const state = region.run(() => ({ points: original, ids: new Int32Array(4), label: 'pts' }));
const points = state.points;
print('copied:', points instanceof Float64Array, points.length, points[2], '| original still', original.length);
points[0] = 10;
print('owner writes:', state.points[0], '| original untouched:', original[0]);
print('fresh view each read:', state.points === state.points, '| same bytes:', state.points[0] === points[0]);
print('keys/json:', Object.keys(state).join(','), JSON.stringify({ ids: [...state.ids] }));

// Transfer list: no copy, the original buffer is detached.
const big = new Float64Array(1_000_000).fill(0.5);
let start = performance.now();
const moved = new Region().run(() => ({ data: big }), [big.buffer]);
const transferMs = performance.now() - start;
const copySource = new Float64Array(1_000_000).fill(0.5);
start = performance.now();
const copied = new Region().run(() => ({ data: copySource }));
const copyMs = performance.now() - start;
print(`transfer 8 MB: ${transferMs.toFixed(3)} ms, copy: ${copyMs.toFixed(3)} ms | original detached: ${big.length === 0}`);
print('moved data:', moved.data.length, moved.data[999_999], copied.data.length);

// Move: the sender's views are detached, the receiver sees the writes.
const worker = new Worker(
  `onmessage = ({ data }) => {
     const p = data.state.points;
     p[1] = p[0] + 1;
     postMessage({ state: data.state, read: [p[0], p[1], p[2]].join(',') }, [Region.of(data.state)]);
   }`,
  { type: 'string' },
);
worker.postMessage({ state }, [region]);
print('sender view after move:', points.length, points[0]);
const back = worker.getMessage();
print('worker saw:', back.read, '| back in main:', [...state.points].join(','));
worker.terminate();

// Freeze: owner views are detached; the owner and borrowers read immutable
// views, which are detached again on thaw and when a borrow ends.
const view = state.points;
region.freeze();
print('owner view after freeze:', view.length);
const frozen = state.points;
frozen[0] = 999;
print('frozen view immutable:', frozen[0]);
const reader = new Worker(
  `onmessage = ({ data }) => {
    using borrow = Region.of(data).borrow();
    const p = data.points;
    p[0] = -1;
    postMessage(p[0] + '/' + p.length);
  }`,
  { type: 'string' },
);
reader.postMessage(state); // shared by reference, not moved
print('reader of frozen region:', reader.getMessage(), '(write ignored)');
reader.terminate();
region.thaw();
print('frozen view after thaw:', frozen.length);
state.points[2] = 30;
print('after thaw owner writes:', state.points[2]);

// spawn: captured typed arrays are copied in, results come back without a copy.
const samples = new Float64Array(100_000).map((_, i) => i);
const stats = spawn(() => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i];
  const squares = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) squares[i] = samples[i] * samples[i];
  return { sum, squares };
}).join();
print('spawn:', stats.sum, stats.squares instanceof Float64Array, stats.squares[3], '| captured original intact:', samples.length);
print('top-level typed array result:', spawn(() => new Uint8Array([7, 8])).join().join(','));

// Not allowed.
expectError('SharedArrayBuffer', () => new Region().run(() => ({ a: new Int32Array(new SharedArrayBuffer(8)) })));
expectError('resizable buffer', () => new Region().run(() => ({ a: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })) })));
expectError('write typed array into region', () => { const r = new Region(); const o = r.run(() => ({ a: null })); o.a = new Int8Array([5]); return o.a[0]; });
gc();
gc();
print('done');

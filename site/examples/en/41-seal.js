// Region.share(): data shared forever, like Arc<T> in Rust. All threads read it,
// without borrows and without copies; it cannot be changed, thawed or freed.
const config = Region.share({
  api: 'https://example.test',
  retries: 3,
  weights: new Float64Array([0.5, 1.5, 2.5]),
});
const region = Region.of(config);
print('sealed:', region.sealed, '| frozen:', region.frozen);

// Tasks read the same objects in parallel: no borrow needed, no copy.
const results = [1, 2, 3].map((n) => spawn((config, n) => {
  const w = config.weights;
  return `task ${n}: ${config.api}, retries ${config.retries}, w[${n - 1}] = ${w[n - 1]}`;
}, config, n));
for (const task of results) print(task.join());

// A worker also reads without a borrow.
const worker = new Worker(
  'onmessage = ({ data }) => postMessage(data.retries * 10)',
  { type: 'string' },
);
worker.postMessage(config);
print('worker:', worker.getMessage());
worker.terminate();

for (const [what, fn] of [
  ['write', () => { config.retries = 5; }],
  ['thaw', () => region.thaw()],
  ['free', () => region.free()],
]) {
  try {
    fn();
  } catch (e) {
    print(what + ':', String(e));
  }
}

// You can seal your own region or a frozen one, even while it is read under
// borrows: the right to thaw is gone for good.
const own = new Region();
const stats = own.run(() => ({ hits: 0 }));
stats.hits = 42;
own.seal();
print('own sealed:', own.sealed, '| hits =', stats.hits);

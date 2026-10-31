// Region.share(): общие данные навсегда, как Arc<T> в Rust. Читают все потоки,
// без билетов и без копий; изменить, разморозить или освободить нельзя.
const config = Region.share({
  api: 'https://example.test',
  retries: 3,
  weights: new Float64Array([0.5, 1.5, 2.5]),
});
const region = Region.of(config);
print('sealed:', region.sealed, '| frozen:', region.frozen);

// Задачи читают те же объекты параллельно: билет не нужен, копии нет.
const results = [1, 2, 3].map((n) => spawn((config, n) => {
  const w = config.weights;
  return `задача ${n}: ${config.api}, retries ${config.retries}, w[${n - 1}] = ${w[n - 1]}`;
}, config, n));
for (const task of results) print(task.join());

// Воркер тоже читает без билета.
const worker = new Worker(
  'onmessage = ({ data }) => postMessage(data.retries * 10)',
  { type: 'string' },
);
worker.postMessage(config);
print('воркер:', worker.getMessage());
worker.terminate();

for (const [what, fn] of [
  ['запись', () => { config.retries = 5; }],
  ['thaw', () => region.thaw()],
  ['free', () => region.free()],
]) {
  try {
    fn();
  } catch (e) {
    print(what + ':', e.message);
  }
}

// Запечатать можно и свой регион, и замороженный, даже пока его читают под
// билетами: право разморозить пропадает навсегда.
const own = new Region();
const stats = own.run(() => ({ hits: 0 }));
stats.hits = 42;
own.seal();
print('own sealed:', own.sealed, '| hits =', stats.hits);

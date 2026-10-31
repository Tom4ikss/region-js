// d8 --harmony-regions bench-access.js
// One access in a hot loop, plain object vs region object: nanoseconds per
// access, best of seven. Run with --no-inline-region-access to see the
// inline cache call instead of the inlined access.
const N = 10_000_000;
const make = (source) => [eval(`(${source})`), eval(`(${source})`)];
const cases = [
  ['field read', '(o) => { let s = 0; for (let i = 0; i < N; i++) s += o.x; return s; }',
   () => ({ x: 1, y: 2 })],
  ['field write', '(o) => { for (let i = 0; i < N; i++) o.x = i & 1023; return o.x; }',
   () => ({ x: 1, y: 2 })],
  ['index read', '(a) => { let s = 0; for (let i = 0; i < N; i++) s += a[i & 1023]; return s; }',
   () => Array.from({ length: 1024 }, (_, i) => i)],
  ['index write', '(a) => { for (let i = 0; i < N; i++) a[i & 1023] = i & 7; return a[5]; }',
   () => Array.from({ length: 1024 }, (_, i) => i)],
];
const best = (fn, arg) => {
  let min = Infinity;
  for (let r = 0; r < 7; r++) {
    const start = performance.now();
    fn(arg);
    min = Math.min(min, performance.now() - start);
  }
  return (min * 1e6) / N;
};
for (const [name, source, data] of cases) {
  const [plainFn, regionFn] = make(source);
  const plain = best(plainFn, data());
  const region = best(regionFn, new Region().run(data));
  print(`${name}: plain ${plain.toFixed(2)} ns, region ${region.toFixed(2)} ns (x${(region / plain).toFixed(1)})`);
}

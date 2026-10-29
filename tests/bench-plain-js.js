// Regular JS only: checks that region changes do not slow down ordinary code.
// d8 bench-plain-js.js
function fastest(fn, runs = 7) {
  fn();
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

const N = 2_000_000;
const shapes = [
  () => ({ a: 1, b: 2 }),
  () => ({ b: 2, a: 1 }),
  () => ({ a: 1, c: 3, b: 2 }),
  () => ({ x: 0, a: 1, b: 2 }),
];
const mono = Array.from({ length: 1000 }, shapes[0]);
const poly = Array.from({ length: 1000 }, (_, i) => shapes[i % 4]());
const mega = Array.from({ length: 1000 }, (_, i) => {
  const o = { a: 1, b: 2 };
  o['k' + (i % 64)] = i;
  return o;
});
class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  norm() { return this.x * this.x + this.y * this.y; }
}
const array = Array.from({ length: 1000 }, (_, i) => i);

const cases = {
  'load monomorphic': () => { let s = 0; for (let i = 0; i < N; i++) s += mono[i % 1000].a; return s; },
  'load polymorphic': () => { let s = 0; for (let i = 0; i < N; i++) s += poly[i % 1000].a; return s; },
  'load megamorphic': () => { let s = 0; for (let i = 0; i < N; i++) s += mega[i % 1000].a; return s; },
  'store monomorphic': () => { for (let i = 0; i < N; i++) mono[i % 1000].b = i; },
  'store polymorphic': () => { for (let i = 0; i < N; i++) poly[i % 1000].b = i; },
  'keyed load by name': () => { let s = 0; const k = ['a', 'b']; for (let i = 0; i < N; i++) s += mono[i % 1000][k[i & 1]]; return s; },
  'array index load': () => { let s = 0; for (let i = 0; i < N; i++) s += array[i % 1000]; return s; },
  'array index store': () => { for (let i = 0; i < N; i++) array[i % 1000] = i; },
  'object literal alloc': () => { let o; for (let i = 0; i < N; i++) o = { i, j: i + 1 }; return o; },
  'class method call': () => { let s = 0; for (let i = 0; i < N; i++) s += new Point(i, 1).norm(); return s; },
  'in operator': () => { let s = 0; for (let i = 0; i < N; i++) if ('a' in poly[i % 1000]) s++; return s; },
};

for (const [name, fn] of Object.entries(cases)) {
  print(`${name.padEnd(22)} ${fastest(fn).toFixed(2)}`);
}

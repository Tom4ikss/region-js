// d8 --harmony-regions --module --allow-natives-syntax --expose-gc --verify-heap region-numbers.js
// Optimized code stores numbers that are not Smis into objects and arrays of
// a region by copying them into the region: numbers of the isolate, of the
// same region and of another one. The copies keep their value, -0 and NaN
// included, through GCs.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const same = (a, b) => Object.is(a, b);

const make = (0, eval)(`'use region'; (n) => {
  const rows = #[];
  for (let i = 0; i < n; i++) rows.push({ x: i + 0.5, total: 0 });
  return rows;
}`);
const N = 2000;
const region = new Region();
const rows = region.run(() => make(N));
const other = new Region().run(() => ({ y: 7.25 }));

// A field, from a computed number of the isolate.
function discount(rows) {
  for (let i = 0; i < rows.length; i++) rows[i].total = rows[i].x * 0.9;
}
// A field, from a number of the same region.
function copyField(rows) {
  for (let i = 0; i < rows.length; i++) rows[i].total = rows[i].x;
}
// A field, from a number of another region.
function fromOther(rows, other) {
  for (let i = 0; i < rows.length; i++) rows[i].total = other.y;
}
// Elements of an array, appended and overwritten.
function fill(list, n, k) {
  for (let i = 0; i < n; i++) list[i] = i * k + 0.25;
}

for (let round = 0; round < 30; round++) {
  discount(rows);
  if (round % 10 === 0) gc();
}
check('a computed number', rows.every((row, i) => row.total === (i + 0.5) * 0.9));
copyField(rows);
copyField(rows);
check('a number of the region', rows.every((row, i) => row.total === i + 0.5));
for (let round = 0; round < 10; round++) fromOther(rows, other);
check('a number of another region', rows.every((row) => row.total === 7.25));

const list = region.run(() => #[]);
for (let round = 0; round < 30; round++) fill(list, 500, round + 1);
gc();
check('elements', list.length === 500 && list.every((v, i) => v === i * 30 + 0.25));

// Special values, from optimized code.
function store(row, v) { row.total = v; }
function storeAt(list, i, v) { list[i] = v; }
%PrepareFunctionForOptimization(store);
%PrepareFunctionForOptimization(storeAt);
store(rows[0], 1.5);
storeAt(list, 0, 1.5);
%OptimizeFunctionOnNextCall(store);
%OptimizeFunctionOnNextCall(storeAt);
for (const v of [-0, NaN, Infinity, -Infinity, 2 ** 53, 1e-300]) {
  store(rows[1], v);
  storeAt(list, 1, v);
  gc();
  check(`stored ${Object.is(v, -0) ? '-0' : v}`, same(rows[1].total, v) && same(list[1], v));
}

// In a task, which owns the region while it runs.
const back = await spawn((rows) => {
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < rows.length; i++) rows[i].total = rows[i].x * 2.5;
  }
  return rows;
}, rows);
gc();
check('in a task', back.every((row, i) => row.total === (i + 0.5) * 2.5));
print('done');

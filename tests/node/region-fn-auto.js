// node --harmony-regions region-fn-auto.js
// Functions of a 'use region' CommonJS module in Node.js: an object of a
// region holds them as functions of Region.fn(), this thread reads them back
// as they are, and spawn() tasks on workers compile them for themselves.
'use strict';
'use region';
const assert = require('node:assert');

function area() { return this.w * this.h; }
function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }
const double = (x) => x * 2;
function callsFact(n) { return fact(n); }

async function main() {
  const region = new Region();
  const shapes = region.run(() => [{ w: 2, h: 3, area }, { w: 4, h: 5, area, f: fact }]);
  assert(Region.isRegionObject(shapes[0]));
  assert.strictEqual(shapes[0].area, area);
  assert.strictEqual(shapes[1].f, fact);
  assert.strictEqual(shapes[1].area(), 20);
  assert.throws(() => region.run(() => ({ f: callsFact })), /cannot use fact of its closure/);
  assert.throws(() => region.run(() => ({ f: require })), /functions of 'use region' code/);

  const total = await spawn((list) => list.reduce((sum, s) => sum + s.area(), 0), shapes);
  assert.strictEqual(total, 26);
  const fromTask = await spawn((list) => [list[1].f(5), list[0].area === list[1].area], shapes);
  assert.deepStrictEqual([...fromTask], [120, true]);

  const all = await Promise.all(Array.from({ length: 32 }, (_, i) => {
    const r = new Region();
    const job = r.run(() => ({ op: double, n: i }));
    return spawn((j) => j.op(j.n), job);
  }));
  assert.deepStrictEqual(all, Array.from({ length: 32 }, (_, i) => i * 2));
  console.log('ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

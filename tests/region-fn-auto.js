// d8 --harmony-regions --expose-gc --verify-heap region-fn-auto.js
'use region';
// In 'use region' code, a function without a closure becomes a function of
// Region.fn() the first time an object of a region is to hold it: the
// function itself, so this thread reads back the same function, and other
// threads compile its source for themselves. A function with a closure
// cannot be held, and the error says why.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const expectError = (name, fn) => {
  try {
    fn();
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};
const isRegion = (value) => Region.isRegionObject(value);

function area() { return this.w * this.h; }
function scale(x) { return x * 3; }
const double = (x) => x * 2;
function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }
function makeRow(n) { return { n, twice: (x) => x * 2 }; }
let counter = 0;
function counts() { return ++counter; }
function callsScale(x) { return scale(x); }
function usesEval() { return eval('1'); }
const withMethod = { m() { return 1; } };
const notRegionCode = (0, eval)('(x) => x');

const region = new Region();
const shape = region.run(() => ({ w: 3, h: 4, area, op: null }));
check('literal', isRegion(shape) && shape.area === area && shape.area() === 12);
shape.op = scale;
check('store', shape.op === scale && shape.op(2) === 6);
const list = region.run(() => [double, fact, double]);
check('arrow, own name', list[0] === double && list[2] === double && list[1](5) === 120);
const plain = { f: scale, g: [area] };
const copied = region.run(() => plain);
check('copied', isRegion(copied) && copied.f === scale && copied.g[0] === area);
check('still plain functions', area.call({ w: 2, h: 5 }) === 10 && typeof scale === 'function');
const row = region.run(() => makeRow(5));
check('arrow in a function', isRegion(row) && row.twice(4) === 8);

expectError('closure', () => region.run(() => ({ f: counts })));
expectError('another function', () => region.run(() => ({ f: callsScale })));
expectError('eval', () => region.run(() => ({ f: usesEval })));
expectError('method', () => region.run(() => ({ f: withMethod.m })));
expectError('not use region code', () => region.run(() => ({ f: notRegionCode })));
expectError('closure, store', () => { shape.op = counts; });
check('store failed', shape.op === scale);

// A class of 'use region' code can use such functions.
class Box {
  w = 0;
  h = 0;
  constructor(w, h) { this.w = w; this.h = h; }
  get size() { return scale(this.w) + fact(this.h); }
}
const box = region.run(() => new Box(2, 3));
check('used by a class', isRegion(box) && box.size === 12);

// Other threads compile the source again.
{
  const r = new Region();
  const shapes = r.run(() => [{ w: 2, h: 2, area }, { w: 1, h: 7, area }]);
  const total = spawn(() => shapes.reduce((sum, s) => sum + s.area(), 0)).join();
  const same = spawn(() => shapes[0].area === shapes[1].area && shapes[0].area !== undefined).join();
  check('task', total === 11 && same === true && shapes[0].area === area);
  const boxSize = spawn(() => box.size).join();
  check('class in a task', boxSize === 12);
  // There it is 'use region' code too: its literals go to the current region.
  const tools = new Region().run(() => ({ makeRow }));
  const inRegion = spawn(() => {
    const own = new Region();
    return own.run(() => {
      const row = tools.makeRow(2);
      return Region.isRegionObject(row) && Region.of(row) === own && row.twice(row.n) === 4;
    });
  }).join();
  check('use region in a task', inRegion === true);
}
{
  const r = new Region();
  const config = r.run(() => ({ op: double, n: 8 }));
  r.freeze();
  const w = new Worker(`
    onmessage = ({ data }) => {
      try {
        using _borrow = Region.of(data).borrow();
        postMessage([data.op(data.n), data.op === data.op].join(' '));
      } catch (e) {
        postMessage(String(e));
      }
    };`, { type: 'string' });
  w.postMessage(config);
  const message = w.getMessage();
  w.terminate();
  check('worker', message === '16 true');
}

// The holder outlives the function; it is compiled again after that.
{
  const r = new Region();
  const kept = r.run(() => ({ g: (x) => x + 1 }));
  for (let i = 0; i < 3; i++) gc();
  check('after gc', kept.g(1) === 2 && kept.g === kept.g && shape.area === area);
}
print('done');

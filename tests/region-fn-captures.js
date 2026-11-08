// d8 --harmony-regions --expose-gc --verify-heap region-fn-captures.js
'use region';
// Functions of 'use region' code that use each other: a function a region
// object holds may refer to other such functions, classes of such code and
// consts with primitive values. Every thread compiles each of them once and
// gives it what it captures, its own copies of the functions and classes,
// also when they refer to each other.
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

const SCALE = 3;
const LABEL = 'total';
let mutable = 1;
function scale(x) { return x * SCALE; }
function sumScaled(list) {
  let sum = 0;
  for (const x of list) sum += scale(x);
  return sum;
}
function report(list) { return LABEL + ': ' + sumScaled(list); }
function isEven(n) { return n === 0 ? true : isOdd(n - 1); }
function isOdd(n) { return n === 0 ? false : isEven(n - 1); }
class Point {
  x = 0;
  y = 0;
  constructor(x, y) { this.x = x; this.y = y; }
  get sum() { return sumScaled([this.x, this.y]); }
}
function makePoint(x) { return new Point(x, scale(x)); }
function makeRows(n) { return Array.from({ length: n }, (_, i) => ({ i, even: isEven(i) })); }
function usesMutable() { return mutable; }
function assigns() { mutable = 2; }
function callsMutable() { return usesMutable() + scale(1); }
function untouched(x) { return x; }
function callsUntouchedAndMutable() { return untouched(1) + usesMutable(); }

const region = new Region();
const tools = region.run(() => ({ sumScaled, report, isEven, makePoint, makeRows }));
check('same thread', tools.sumScaled === sumScaled && tools.report([1, 2]) === 'total: 9' &&
      tools.isEven(10) === true && tools.isEven(7) === false);
const odd = new Region().run(() => ({ isOdd, scale }));
check('captured ones became such functions too', odd.isOdd === isOdd && odd.scale === scale);
const point = region.run(() => tools.makePoint(2));
check('class captured', point instanceof Point && Region.of(point) === region && point.sum === 24);

expectError('not a const', () => new Region().run(() => ({ f: usesMutable })));
expectError('assigns', () => new Region().run(() => ({ f: assigns })));
expectError('through another function', () => new Region().run(() => ({ f: callsMutable })));
expectError('nothing changes on an error', () => new Region().run(() => ({ f: callsUntouchedAndMutable })));
let untouchedHeld = false;
try {
  new Region().run(() => ({ untouched }));
  untouchedHeld = true;
} catch (e) {}
check('untouched still converts by itself', untouchedHeld);

const viaFn = Region.fn((list) => sumScaled(list) + 1);
const viaHolder = new Region().run(() => ({ viaFn }));
check('Region.fn captures', viaFn([1]) === 4 && viaHolder.viaFn === viaFn);

// Other threads compile them, with their own copies of what they capture.
{
  const fromTask = spawn(() => {
    const p = tools.makePoint(2);
    const own = new Region();
    const rows = own.run(() => tools.makeRows(3));
    return [
      tools.sumScaled([1, 2, 3]), tools.report([1]), tools.isEven(7), tools.isEven(8),
      p.y, p.sum, Object.getPrototypeOf(p).constructor.name,
      Region.of(rows[2]) === own, rows[2].even, viaHolder.viaFn([1, 1]),
    ].join();
  }).join();
  check('task', fromTask === '18,total: 3,false,true,6,24,Point,true,true,7');
}
{
  const shared = new Region();
  const config = shared.run(() => ({ report, isOdd }));
  shared.freeze();
  const w = new Worker(`
    onmessage = ({ data }) => {
      try {
        using _borrow = Region.of(data).borrow();
        postMessage([data.report([2]), data.isOdd(9), data.isOdd === data.isOdd].join());
      } catch (e) {
        postMessage(String(e));
      }
    };`, { type: 'string' });
  w.postMessage(config);
  const message = w.getMessage();
  w.terminate();
  check('worker', message === 'total: 6,true,true');
}

{
  for (let i = 0; i < 3; i++) gc();
  check('after gc', spawn(() => tools.isEven(100)).join() === true && tools.isEven(3) === false);
}
print('done');

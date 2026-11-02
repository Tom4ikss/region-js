// d8 --harmony-regions --module --allow-natives-syntax --expose-gc --verify-heap region-fn.js
// Region.fn(f): functions region objects can hold. Each region keeps a holder
// of the code; every isolate reads it back as its own compiled function, the
// same one for the same Region.fn.
const expectError = (name, fn) => {
  try {
    fn();
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};

// What a function may use.
const limit = 10;
expectError('captured variable', () => Region.fn((x) => x + limit));
expectError('this of an arrow', () => ({ m() { return Region.fn(() => this.n); } }).m());
expectError('eval', () => Region.fn(() => eval('1')));
expectError('class', () => Region.fn(class {}));
expectError('method', () => Region.fn({ m() { return 1; } }.m));
expectError('not a function', () => Region.fn(42));
expectError('native function', () => Region.fn(Math.max));
const double = Region.fn((x) => x * 2);
print('builtins and globals:', Region.fn((xs) => Math.max(...xs) + JSON.stringify(xs).length)([1, 5]));
print('same function back:', typeof double, double(21));
const fact = Region.fn(function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); });
print('own name:', fact(10));

// Stored into regions: through run, literals and property sets.
const a = new Region().run(() => ({ f: double, list: [double, fact] }));
const b = new Region().run(() => ({ f: null, g: null }));
b.f = double;
print('identity:', a.f === double, b.f === double, a.list[0] === a.f, a.list[1] === fact);
print('calls:', a.f(4), b.f(5), a.list[1](5));
print('includes:', a.list.includes(fact), a.list.indexOf(fact), a.list.indexOf(() => 1));
b.f = double;
b.f = fact;
print('overwritten:', b.f === fact, b.f(4));
print('plain function rejected:');
expectError('  store', () => { b.g = (x) => x; });
expectError('  literal', () => new Region().run(() => ({ g: (x) => x })));

// this follows the call, like any method.
const area = Region.fn(function () { return this.w * this.h; });
const rect = new Region().run(() => ({ w: 3, h: 4, area }));
print('method this:', rect.area(), area.call({ w: 2, h: 5 }));

// A stack trace points at where the function was written.
const fails = Region.fn(() => { throw new Error('boom'); });
const holder = new Region().run(() => ({ fails }));
try {
  holder.fails();
} catch (e) {
  print('stack:', e.stack.split('\n')[1].replace(/.*\//, '').trim());
}

// In a task: the region moves there and back.
{
  const region = new Region();
  const shapes = region.run(() => [{ w: 2, h: 2, area }, { w: 1, h: 7, area }]);
  const total = spawn(() => shapes.reduce((sum, s) => sum + s.area(), 0)).join();
  print('task:', total, shapes[0].area === area);
  const sameInTask = spawn(() => shapes[0].area === shapes[1].area).join();
  print('identity in a task:', sameInTask);
}

// A frozen region shared with a worker, and a channel.
{
  const region = new Region();
  const config = region.run(() => ({ scale: Region.fn((x) => x * 3), name: 'cfg' }));
  region.freeze();
  const w = new Worker(`
    onmessage = ({ data }) => {
      try {
        using _borrow = Region.of(data).borrow();
        postMessage([data.scale(7), data.scale === data.scale, typeof data.scale].join(' '));
      } catch (e) {
        postMessage(String(e));
      }
    };`, { type: 'string' });
  w.postMessage(config);
  print('worker:', w.getMessage());
  w.terminate();

  const ch = new Channel(1);
  const msg = new Region().run(() => ({ op: double, arg: 8 }));
  await ch.send(msg);
  const got = (await ch.recv()).value;
  print('channel:', got.op(got.arg), got.op === double);
}

// Hot loops: optimized code reads holders through the runtime.
{
  const items = new Region().run(() => Array.from({ length: 100 }, (_, i) => ({ i, f: double })));
  const sum = (xs) => { let s = 0; for (const x of xs) s += x.f(x.i); return s; };
  const at = (xs, k) => xs[k].f;
  %PrepareFunctionForOptimization(sum);
  %PrepareFunctionForOptimization(at);
  sum(items); sum(items); at(items, 1); at(items, 2);
  %OptimizeMaglevOnNextCall(sum);
  print('maglev:', sum(items));
  %OptimizeFunctionOnNextCall(sum);
  %OptimizeFunctionOnNextCall(at);
  print('turbofan:', sum(items), at(items, 50) === double);
}

// Holders survive GC; the function is compiled again once collected.
{
  const region = new Region();
  const kept = region.run(() => ({ f: Region.fn((x) => x - 1) }));
  for (let i = 0; i < 3; i++) gc();
  print('after gc:', kept.f(10), kept.f === kept.f);
  region.free();
  try {
    kept.f;
  } catch (e) {
    print('freed:', e.name, e.reason);
  }
}

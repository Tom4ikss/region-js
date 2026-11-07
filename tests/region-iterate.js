// d8 --harmony-regions --allow-natives-syntax region-iterate.js
// for...of over arrays of a region and methods of their prototypes in
// optimized code. In a loop Turbofan reads Array.prototype[Symbol.iterator]
// and other methods of the local prototypes as constants and inlines the
// array iterator. Every result here must match the interpreter's (compare
// with --jitless).
const optimize = (fn, ...warmup) => {
  %PrepareFunctionForOptimization(fn);
  fn(...warmup);
  fn(...warmup);
  %OptimizeFunctionOnNextCall(fn);
  fn(...warmup);
  return fn;
};
const failure = (fn) => {
  try {
    return fn();
  } catch (e) {
    return e.name;
  }
};
const tier = (fn) =>
  !%IsTurbofanEnabled() || %ActiveTierIsTurbofan(fn) ? 'optimized' : 'deoptimized';
const worker = () => new Worker('onmessage = () => {};', { type: 'string' });
const make = (0, eval)(`'use region'; (n) => {
  const rows = #[];
  for (let i = 0; i < n; i++) rows.push({ x: i, items: [{ q: i }, { q: 1 }] });
  return rows;
}`);

// Nested loops over arrays of a region.
{
  const rows = new Region().run(() => make(100));
  const sum = optimize((rows) => {
    let s = 0;
    for (const row of rows) {
      for (const item of row.items) s += item.q;
    }
    return s;
  }, rows);
  const keys = optimize((rows) => {
    let s = 0;
    for (const row of rows) {
      for (const k of row.items.keys()) s += k;
    }
    return s;
  }, rows);
  const entries = optimize((rows) => {
    let s = 0;
    for (const row of rows) {
      for (const [k, item] of row.items.entries()) s += k * item.q;
    }
    return s;
  }, rows);
  print('nested:', sum(rows), keys(rows), entries(rows), tier(sum), tier(keys));
}

// The array grows while the loop goes over it.
{
  const list = new Region().run(() => [1, 2, 3]);
  const grow = optimize((list) => {
    let n = 0;
    for (let round = 0; round < 1; round++) {
      for (const v of list) {
        if (v < 3 && list.length < 6) list.push(v + 3);
        n++;
      }
    }
    return n;
  }, list);
  print('grow:', grow(list), list.length);
}

// Elements the inline iterator can't read: a function and a typed array.
{
  const r = new Region();
  const list = r.run(() => [1, 2, 3, 4]);
  const kinds = optimize((list) => {
    let s = '';
    for (let round = 0; round < 1; round++) {
      for (const v of list) s += typeof v === 'number' ? v : v.constructor.name;
    }
    return s;
  }, list);
  r.run(() => {
    list[1] = Region.fn(() => 0);
    list[2] = new Uint8Array(2);
  });
  print('kinds:', kinds(list));
}

// Methods of the prototypes in a loop: the same on arrays and objects, and
// different ones.
{
  const r = new Region();
  const a = r.run(() => [1, 2]);
  const o = r.run(() => ({ a: 1 }));
  const has = optimize((xs) => {
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const x = xs[i % 2];
      if (x.hasOwnProperty('a') || x.hasOwnProperty('0')) n++;
    }
    return n;
  }, [a, o]);
  const strings = optimize((xs) => {
    let s = '';
    for (let i = 0; i < 4; i++) s += xs[i % 2].toString() + ';';
    return s;
  }, [a, o]);
  print('methods:', has([a, o]), strings([a, o]), tier(has));
}

// A method of Object.prototype that Array.prototype gets later.
{
  const r = new Region();
  const a = r.run(() => [1, 2, 3]);
  Object.prototype.describe = function () { return 'object'; };
  const describe = optimize((a, n) => {
    let s = '';
    for (let i = 0; i < n; i++) s = a.describe();
    return s;
  }, a, 3);
  const before = describe(a, 3);
  Array.prototype.describe = function () { return 'array'; };
  print('shadowed:', before, describe(a, 3));
  delete Array.prototype.describe;
  delete Object.prototype.describe;
}

// A replaced iterator.
{
  const rows = new Region().run(() => make(10));
  const count = optimize((rows) => {
    let n = 0;
    for (const row of rows) {
      for (const item of row.items) n++;
    }
    return n;
  }, rows);
  const saved = Array.prototype[Symbol.iterator];
  const before = count(rows);
  Array.prototype[Symbol.iterator] = function* () { yield this[0]; };
  const after = count(rows);
  Array.prototype[Symbol.iterator] = saved;
  print('replaced:', before, after, count(rows));
}

// A call in the outer loop moves an inner array to a worker: the next inner
// loop fails.
{
  const w = worker();
  const rows = new Region().run(() => make(1));
  const lists = [rows, new Region().run(() => make(1)), rows];
  let moveAt = -1;
  const maybeMove = (i) => {
    if (i === moveAt) w.postMessage(lists[1], [lists[1]]);
  };
  const sum = optimize((lists) => {
    let s = 0;
    for (let i = 0; i < lists.length; i++) {
      maybeMove(i);
      for (const row of lists[i]) s += row.x + 1;
    }
    return s;
  }, lists);
  moveAt = 1;
  print('move:', failure(() => sum(lists)));
  w.terminate();
}
print('done');

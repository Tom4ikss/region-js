// d8 --harmony-regions --module --allow-natives-syntax --verify-heap array-ic.js
// a[i] = v and push() on region arrays: inline caches and the push builtin
// store without the runtime while the array has room, and fall back to it for
// everything else. The results must not depend on which path ran.
const expectError = (name, fn) => {
  try {
    print(`${name}: NO ERROR ->`, fn());
  } catch (e) {
    print(`${name}:`, e.message);
  }
};

const region = new Region();
const other = new Region();

// Hot loops: stores in bounds, at the end, and pushes that cross a growth.
{
  const a = region.array();
  for (let i = 0; i < 1000; i++) a.push(i);
  for (let i = 0; i < a.length; i++) a[i] = a[i] * 2;
  for (let i = a.length; i < 2000; i++) a[i] = i * 2;
  let ok = a.length === 2000;
  for (let i = 0; i < a.length; i++) ok &&= a[i] === i * 2;
  print('hot stores and pushes:', ok);
}

// push() returns the new length; other arities go through the runtime.
{
  const a = region.array();
  print('push returns length:', a.push('x'), a.push(1, 2, 3), a.push(), a.length,
        JSON.stringify(a));
}

// Values the fast path can't store as they are: the runtime copies or rejects.
{
  const a = region.array();
  using _ = region.enter();
  a.push(1.5);
  a.push('local ' + String(a.length));
  a.push(new Uint8Array([7, 8]));
  a[a.length] = 2 ** 40;
  a.push(null, undefined, true);
  a.push(Region.object({ ok: 1 }));
  print('copied values:', a.length, a[0], a[1], a[2][1], a[3], a[7].ok);
  expectError('plain object', () => a.push({ a: 1 }));
  expectError('plain object by index', () => { a[a.length] = { a: 1 }; });
  expectError('other region', () => a.push(other.array()));
  expectError('other region by index', () => { a[0] = other.array(); });
  print('length after rejects:', a.length);
}

// Indices the fast path leaves to the runtime.
{
  const a = region.array();
  a.push(0, 1);
  a[5] = 5;
  print('past the end:', a.length, JSON.stringify(a));
  a['1'] = 'string key';
  expectError('negative index', () => { a[-1] = 'neg'; });
  expectError('fractional index', () => { a[1.5] = 'fraction'; });
  print('odd keys:', a[1], a.length);
  expectError('new property on an object', () => {
    const o = region.object({ a: 1 });
    o[0] = 1;
  });
}

// Denied: frozen, freed, owned by another isolate.
{
  const r = new Region();
  const a = r.array(1);
  const store = (x, i, v) => { x[i] = v; };
  const push = (x, v) => x.push(v);
  for (let i = 0; i < 10; i++) { store(a, 0, i); push(a, i); }
  r.freeze();
  expectError('store into frozen', () => store(a, 0, 1));
  expectError('push into frozen', () => push(a, 1));
  r.thaw();
  print('after thaw:', push(a, 'x'), a.length);
  r.free();
  expectError('store into freed', () => store(a, 0, 1));
  expectError('push into freed', () => push(a, 1));
}
{
  const r = new Region();
  const a = r.array(1, 2);
  const w = new Worker(`
    onmessage = ({ data }) => {
      const out = [];
      for (const f of [() => { data[0] = 1; }, () => data.push(1)]) {
        try { f(); out.push('no error'); } catch (e) { out.push(e.message); }
      }
      postMessage(out.join(' | '));
    };`, { type: 'string' });
  w.postMessage(a);
  print('not the owner:', w.getMessage());
  w.terminate();
}

// One site sees plain and region arrays: polymorphic and megamorphic stores.
{
  const store = (x, i, v) => { x[i] = v; };
  const push = (x, v) => x.push(v);
  const targets = [[], region.array(), [1.5], region.array(1), { length: 0 },
                   new Uint8Array(4), region.array('a')];
  const arrays = [[], region.array(), [1.5], region.array(1), ['a'],
                  region.array('a')];
  for (let round = 0; round < 50; round++) {
    for (const t of targets) store(t, 0, round);
    for (const a of arrays) push(a, round);
  }
  print('mixed sites:', targets.map((t) => t[0]).join(','),
        arrays.map((a) => `${a.length}:${a.at(-1)}`).join(','));
}

// Optimized code calls the same paths.
{
  const fill = (a, n) => {
    for (let i = 0; i < n; i++) a.push(i);
    for (let i = 0; i < n; i++) a[i] += 1;
    return a.length;
  };
  %PrepareFunctionForOptimization(fill);
  fill(region.array(), 10);
  fill(region.array(), 10);
  %OptimizeFunctionOnNextCall(fill);
  const a = region.array();
  print('optimized:', fill(a, 1000), a[0], a[999]);
  const r = new Region();
  const b = r.array();
  r.freeze();
  expectError('optimized into frozen', () => fill(b, 1));
}

// Methods come from the prototype of the current native context. The inline
// cache keeps them as constants, but still checks access, and drops them when
// the prototype changes.
{
  const r = new Region();
  const a = r.array(1, 2, 3);
  const getPush = (x) => x.push;
  const sum = (x) => x.reduce((s, v) => s + v, 0);
  for (let i = 0; i < 100; i++) { getPush(a); sum(a); }
  print('cached method:', getPush(a) === Array.prototype.push, sum(a));
  const original = Array.prototype.push;
  Array.prototype.push = function () { return 'patched'; };
  print('patched prototype:', a.push(4), a.length);
  Array.prototype.push = original;
  print('restored:', a.push(4), a.length);
  r.free();
  expectError('cached method of a freed region', () => getPush(a));
}
{
  const r = new Region();
  const a = r.array();
  const o = r.object({ x: 1 });
  const realm = Realm.create();
  const otherPush = Realm.eval(realm, 'Array.prototype.push');
  const otherGet = Realm.eval(realm, `(x) => x.push`);
  const otherHas = Realm.eval(realm, `(x) => x.hasOwnProperty`);
  // Many maps make the sites megamorphic, so both realms share the stub cache.
  const get = (x) => x.push;
  const has = (x) => x.hasOwnProperty;
  const shapes = Array.from({ length: 10 }, (_, i) => Object.assign([], { ['p' + i]: i }));
  for (let i = 0; i < 100; i++) {
    for (const s of shapes) { get(s); otherGet(s); has(s); otherHas(s); }
    get(a); has(o);
  }
  print('other realm:', otherGet(a) === otherPush, get(a) === Array.prototype.push,
        otherHas(o) === Realm.eval(realm, 'Object.prototype.hasOwnProperty'),
        has(o) === Object.prototype.hasOwnProperty);
}
{
  // A frozen region: methods are read under a borrow only.
  const r = new Region();
  const a = r.array(1, 2);
  r.freeze();
  const w = new Worker(`
    onmessage = ({ data }) => {
      const join = (x) => x.join;
      let warm;
      {
        using _ = Region.of(data).borrow();
        for (let i = 0; i < 100; i++) warm = join(data);
      }
      let after;
      try { join(data); after = 'no error'; } catch (e) { after = e.message; }
      postMessage(typeof warm + ' | ' + after);
    };`, { type: 'string' });
  w.postMessage(a);
  print('method after the borrow:', w.getMessage());
  w.terminate();
}

// d8 --harmony-region-literals --module --allow-natives-syntax --expose-gc --verify-heap literals-fast.js
// #{} and #[] in generated code: after the first literal of a shape, objects
// are allocated without the runtime. Whatever path a literal takes, the
// result, the errors and the bytes counted for the region must be the same.
const expectError = (name, fn) => {
  try {
    print(`${name}: NO ERROR ->`, fn());
  } catch (e) {
    print(`${name}:`, e.message);
  }
};

const region = new Region();

// Hot loops of one shape: every object correct, one map, bytes per literal
// the same for the first (runtime) and the rest (generated code).
{
  using _ = region.enter();
  const make = (i) => #{ id: i, price: i * 2, name: 'n', ok: true, none: null };
  const before = region.byteSize;
  const first = make(0);
  const perLiteral = region.byteSize - before;
  const list = [];
  for (let i = 1; i <= 100000; i++) list.push(make(i));
  let ok = true;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    ok &&= o.id === i + 1 && o.price === (i + 1) * 2 && o.name === 'n' && o.ok && o.none === null;
  }
  print('object loop:', ok, Region.of(list[99999]).id === region.id,
        %HaveSameMap(first, list[99999]),
        'bytes per literal equal:', (region.byteSize - before) === perLiteral * 100001);
  const arrays = [];
  for (let i = 0; i < 100000; i++) arrays.push(#[i, i + 1, 'x']);
  print('array loop:', arrays[99999][1], arrays[99999].length, arrays[5].join('|'),
        %HaveSameMap(arrays[0], arrays[99999]));
  print('empty:', JSON.stringify(#{}), JSON.stringify(#[]), #[].length);
}

// Values the generated code leaves to the runtime, in a hot site.
{
  using _ = region.enter();
  const make = (v) => #{ v };
  for (let i = 0; i < 1000; i++) make(i);
  const inner = #{ x: 1 };
  print('values:', make(1.5).v, make('local ' + String(7)).v, make(2 ** 40).v,
        make(new Uint8Array([4, 5])).v[1], make(inner).v === inner, make(undefined).v);
  expectError('plain object', () => make({ a: 1 }));
  expectError('other region', () => make(new Region().run(() => ({}))));
}

// Many shapes: more than the cache holds, and collisions.
{
  using _ = region.enter();
  const makers = [];
  for (let n = 0; n < 200; n++) {
    makers.push(new Function('v', `return #{ k${n}: v, k${n}b: v + 1 };`));
  }
  let ok = true;
  for (let round = 0; round < 20; round++) {
    for (let n = 0; n < makers.length; n++) {
      const o = makers[n](round);
      ok &&= o[`k${n}`] === round && o[`k${n}b`] === round + 1;
    }
  }
  print('many shapes:', ok);
  const keys = Array.from({ length: 40 }, (_, i) => `f${i}: ${i}`).join(', ');
  const long = new Function(`return #{ ${keys} };`);
  for (let i = 0; i < 5; i++) long();
  print('long literal:', long().f39, Object.keys(long()).length);
}

// The region must be current, owned and not frozen or freed.
{
  const make = () => #{ a: 1 };
  const r = new Region();
  {
    using _ = r.enter();
    for (let i = 0; i < 1000; i++) make();
  }
  expectError('no current region', make);
  {
    using _ = r.enter();
    r.freeze();
    expectError('frozen', make);
    r.thaw();
    print('after thaw:', make().a);
    r.free();
    expectError('freed', make);
  }
}

// Other realms have their own builtins and caches.
{
  const realm = Realm.create();
  const make = Realm.eval(realm, '(r) => { using _ = r.enter(); return #{ a: 1, b: 2 }; }');
  let last;
  for (let i = 0; i < 1000; i++) last = make(region);
  print('other realm:', last.b, Region.of(last).id === region.id);
}

// GC while literals are created: the area of the thread is reset and objects
// stay valid.
{
  using _ = region.enter();
  const keep = [];
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 5000; j++) keep.push(#{ i, j, tag: #['a', j] });
    gc();
  }
  let ok = true;
  for (let k = 0; k < keep.length; k++) ok &&= keep[k].tag[1] === keep[k].j;
  print('gc:', ok, keep.length);
}

// Tasks: every thread allocates in its own area.
{
  const lists = Array.from({ length: 4 }, () => new Region().array());
  const counts = await Promise.all(lists.map((list) => spawn(() => {
    using _ = Region.of(list).enter();
    for (let i = 0; i < 50000; i++) list.push(#{ i, sq: i * i });
    let ok = true;
    for (let i = 0; i < list.length; i++) ok &&= list[i].sq === i * i;
    return ok ? list.length : -1;
  })));
  print('tasks:', counts.join(','));
}

// Values copied in generated code: numbers and short sequential strings,
// one-byte and two-byte. Longer strings and cons strings go to the runtime.
// Contents and the bytes counted for the region match either way.
{
  const r = new Region();
  using _ = r.enter();
  const make = (n, s) => #{ n, s };
  for (let i = 0; i < 1000; i++) make(i + 0.5, 'warm ' + i);
  const cases = [
    [0.5, 'a' + String(1)],
    [-0, 'товар ' + String(2)],
    [NaN, 'x'.repeat(300) + String(3)],
    [2 ** 53, ['left', String(4), 'right'].join('-').padEnd(20, '.')],
    [1e-300, 'cons ' + 'string that is long enough ' + String(5)],
  ];
  const results = cases.map(([n, s]) => {
    const before = r.byteSize;
    const o = make(n, s);
    return [Object.is(o.n, n), o.s === s, o.s.length === s.length, r.byteSize - before];
  });
  print('copied values:', results.map((x) => x.slice(0, 3).join('/')).join(' '));
  // The same values through the C++ path: a fresh shape is never cached.
  const slow = cases.map(([n, s]) => {
    const before = r.byteSize;
    new Function('n', 's', 'return #{ fresh' + Math.random().toString(36).slice(2) + ': n, s };')(n, s);
    return r.byteSize - before;
  });
  print('bytes like the C++ path:', results.map((x) => x[3]).join(',') === slow.join(','));
  const keyed = make(1, 'ключ ' + String(7));
  const lookup = { ['ключ 7']: 'found' };
  print('copied string as a key:', lookup[keyed.s], keyed.s === 'ключ 7');
}

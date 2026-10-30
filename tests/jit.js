// d8 --harmony-regions --module --allow-natives-syntax --verify-heap jit.js
// Region access in optimized code: Turbofan inlines loads and stores of
// region objects and falls back to the generic access whenever the fast path
// can't do it. Every result here must match the interpreter's.
const optimize = (fn, ...warmup) => {
  %PrepareFunctionForOptimization(fn);
  fn(...warmup);
  fn(...warmup);
  %OptimizeFunctionOnNextCall(fn);
  fn(...warmup);
  return fn;
};
const attempt = (fn) => {
  try {
    return fn();
  } catch (e) {
    return e.message;
  }
};

// Fields: loads, stores, array length, keyed access with a name.
{
  const r = new Region();
  const o = r.run(() => ({ x: 1, y: 'two', list: [1, 2, 3] }));
  const read = optimize((o) => o.x + o.y + o.list.length, o);
  const write = optimize((o, v) => { o.x = v; return o.x; }, o, 5);
  const keyed = optimize((o, k) => o[k], o, 'y');
  print('fields:', read(o), write(o, 7), keyed(o, 'y'), keyed(o, 'x'));
  // Values the fast path can't store as they are.
  print('stores via runtime:', write(o, 1.5), write(o, 'local ' + String(write.length)),
        attempt(() => write(o, { plain: true })));
}

// Shapes: several maps with the property at the same position, and a site
// that mixes positions.
{
  const r = new Region();
  const a = r.run(() => ({ x: 1, y: 2 }));
  const b = r.run(() => ({ x: 10, z: 20 }));
  const c = r.run(() => ({ w: 0, x: 100 }));
  const getX = optimize((o) => o.x, a);
  print('same position:', getX(a), getX(b));
  getX(c);
  print('other position:', getX(c), getX(a));
}

// Elements: in bounds, past the end, prototype elements, append and holes.
{
  const r = new Region();
  const arr = r.run(() => [0, 1, 2]);
  const get = optimize((a, i) => a[i], arr, 1);
  const set = optimize((a, i, v) => { a[i] = v; return a.length; }, arr, 0, 9);
  print('elements:', get(arr, 0), get(arr, 2), get(arr, 3), get(arr, -1), get(arr, 'length'));
  Array.prototype[10] = 'from prototype';
  print('prototype element:', get(arr, 10));
  delete Array.prototype[10];
  print('append:', set(arr, 3, 3), set(arr, 4, 4), JSON.stringify(arr));
  print('past the end:', set(arr, 7, 7), JSON.stringify(arr));
}

// Typed arrays in a region are read as fresh local views.
{
  const r = new Region();
  const o = r.run(() => ({ bytes: new Uint8Array([1, 2, 3]), n: 1 }));
  const getBytes = optimize((o) => o.bytes, o);
  const view = getBytes(o);
  print('typed array:', view instanceof Uint8Array, view[2], getBytes(o) !== view);
}

// Denied: frozen without a borrow, freed, moved to a worker. With try/catch
// in the optimized function, the generic path's exception reaches the catch.
{
  const r = new Region();
  const o = r.run(() => ({ x: 1, list: [1, 2] }));
  const read = optimize((o) => { try { return o.x + o.list[1]; } catch (e) { return 'caught: ' + e.message; } }, o);
  const write = optimize((o) => { try { o.x = 2; o.list[0] = 2; return 'ok'; } catch (e) { return 'caught: ' + e.message; } }, o);
  r.freeze();
  print('frozen by us:', read(o), write(o));
  r.thaw();
  const w = new Worker(`onmessage = ({ data }) => postMessage(Region.of(data).id);`, { type: 'string' });
  w.postMessage(o, [r]);
  w.getMessage();
  print('moved:', read(o), write(o));
  w.terminate();
  const r2 = new Region();
  const o2 = r2.run(() => ({ x: 1, list: [1, 2] }));
  read(o2);
  r2.free();
  print('freed:', read(o2), write(o2));
}

// Readers of a frozen region in another thread, with and without a borrow.
{
  const r = new Region();
  const data = r.run(() => ({ values: Array.from({ length: 1000 }, (_, i) => i) }));
  r.freeze();
  const w = new Worker(`
    const sum = (d) => { let s = 0; for (let i = 0; i < d.values.length; i++) s += d.values[i]; return s; };
    onmessage = ({ data }) => {
      let result;
      {
        using _ = Region.of(data).borrow();
        for (let k = 0; k < 2000; k++) result = sum(data);
      }
      let after;
      try { after = sum(data); } catch (e) { after = e.message; }
      postMessage(result + ' | ' + after);
    };`, { type: 'string' });
  w.postMessage(data);
  print('frozen readers:', w.getMessage());
  w.terminate();
}

// Hot loops over literals, as #{} code runs them.
{
  const r = new Region();
  const list = r.run(() => Array.from({ length: 10000 }, (_, i) => ({ id: i, price: i % 100 })));
  const total = optimize((l) => { let s = 0; for (let i = 0; i < l.length; i++) s += l[i].price; return s; }, list);
  const bump = optimize((l) => { for (let i = 0; i < l.length; i++) l[i].price += 1; return l[0].price; }, list);
  print('hot loops:', total(list), bump(list), total(list));
}

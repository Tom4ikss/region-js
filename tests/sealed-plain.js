// d8 --harmony-regions --allow-natives-syntax --expose-gc --verify-heap sealed-plain.js
// When a region is sealed, its objects whose values are all plain (no typed
// array, function or LocalRef) get the sealed plain map of their shape: the
// same keys, another map. Such an object never changes, so optimized code
// reads it after the map check alone, without checking the region or the
// value. Objects with a holder keep the usual map, and so do frozen regions.
// The tests read through optimized code that also sees owned objects and
// holders of the same shape, and check that writes still fail.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const errorOf = (fn) => {
  try {
    fn();
    return 'no error';
  } catch (e) {
    return e.message;
  }
};

const rowsOf = (n) => {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ id: i, name: 'item ' + i, price: i + 0.25, tags: [i, i + 1] });
  }
  return rows;
};
// What total() gives for rowsOf(n).
const expected = (n) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += i + 0.25 + (i + 1);
  return s;
};

const owned = new Region();
const mine = owned.run(() => rowsOf(10));
const shared = Region.share(rowsOf(1000));
check('sealed objects get another map', !%HaveSameMap(mine[0], shared[0]));
check('one map for the shape', %HaveSameMap(shared[0], shared[999]));
check('arrays too', !%HaveSameMap(mine, shared) &&
    !%HaveSameMap(mine[0].tags, shared[0].tags) &&
    %HaveSameMap(shared[0].tags, shared[1].tags));
const holder = Region.share(
    { id: 1, name: 'h', price: 1.25, tags: new Float64Array([1, 2]) });
check('a holder keeps the usual map', %HaveSameMap(holder, mine[0]));
check('keys and values stay', JSON.stringify(shared[3]) ===
    '{"id":3,"name":"item 3","price":3.25,"tags":[3,4]}' &&
    Object.keys(shared[3]).join() === 'id,name,price,tags');

// A loop over the rows: the access is speculative there.
function total(rows) {
  let s = 0;
  for (let i = 0; i < rows.length; i++) s += rows[i].price + rows[i].tags[1];
  return s;
}
%PrepareFunctionForOptimization(total);
total(shared);
total(shared);
%OptimizeFunctionOnNextCall(total);
check('optimized loop', total(shared) === expected(1000));
check('same code, owned rows', total(mine) === expected(10));

// Single reads outside a loop, as in a comparator.
function describe(row) {
  return row.name + ':' + row.tags[0] + ':' + row.tags.length;
}
%PrepareFunctionForOptimization(describe);
describe(shared[3]);
describe(shared[4]);
%OptimizeFunctionOnNextCall(describe);
check('optimized single reads', describe(shared[7]) === 'item 7:7:2');
check('a holder through the same code', describe(holder) === 'h:1:2');
check('owned row through the same code', describe(mine[2]) === 'item 2:2:2');
const byPrice = (a, b) => b.price - a.price || a.id - b.id;
check('sort with a comparator',
    [...shared].sort(byPrice).slice(0, 3).map((r) => r.id).join() ===
        '999,998,997');

// Elements: out of bounds is still undefined.
function at(rows, i) {
  return rows[i];
}
%PrepareFunctionForOptimization(at);
at(shared, 1);
at(shared, 2);
%OptimizeFunctionOnNextCall(at);
check('optimized element', at(shared, 5) === shared[5] &&
    at(shared, 1000) === undefined && at(shared, -1) === undefined &&
    at(shared[0].tags, 1) === 1);

function ids(rows) {
  let s = 0;
  for (const row of rows) s += row.id;
  return s;
}
%PrepareFunctionForOptimization(ids);
ids(shared);
%OptimizeFunctionOnNextCall(ids);
check('optimized for...of', ids(shared) === 999 * 1000 / 2 && ids(mine) === 45);

// Writes fail, also from code optimized for owned rows.
function setPrice(row, price) {
  row.price = price;
}
%PrepareFunctionForOptimization(setPrice);
setPrice(mine[0], 1);
setPrice(mine[1], 2);
%OptimizeFunctionOnNextCall(setPrice);
setPrice(mine[2], 3);
check('owned write', mine[2].price === 3);
check('sealed write fails', errorOf(() => setPrice(shared[0], 5)) !==
    'no error' && shared[0].price === 0.25);
check('sealed push fails', errorOf(() => shared.push(1)) !== 'no error' &&
    shared.length === 1000);

// seal() of a region that was owned.
const later = new Region();
const rows = later.run(() => rowsOf(5));
check('owned rows have the usual map', %HaveSameMap(rows[0], mine[0]));
later.seal();
check('seal() gives the sealed map', %HaveSameMap(rows[0], shared[0]) &&
    %HaveSameMap(rows, shared));
check('optimized code reads them', total(rows) === expected(5) &&
    describe(rows[4]) === 'item 4:4:2');

// A frozen region keeps the usual maps: its owner may thaw it.
const frozen = new Region();
const cold = frozen.run(() => rowsOf(3));
frozen.freeze();
check('frozen keeps the map', %HaveSameMap(cold[0], mine[0]));
frozen.thaw();
setPrice(cold[1], 7);
check('thawed write', cold[1].price === 7);

gc();
check('after a GC', total(shared) === expected(1000) &&
    describe(shared[999]) === 'item 999:999:2' && total(rows) === expected(5));

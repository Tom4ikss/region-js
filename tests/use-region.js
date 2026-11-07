// d8 --harmony-regions --expose-gc --verify-heap use-region.js
// 'use region': {} and [] in the function, and in the functions inside it,
// are #{} and #[] while a region is current, and plain objects otherwise.
// Destructuring patterns stay patterns.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const syntaxError = (body) => {
  try {
    new Function(`'use region'; ${body}`);
    return 'no error';
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};
const isRegion = (value) => Region.isRegionObject(value);

const region = new Region();

function build(rows) {
  'use region';
  using _ = region.enter();
  const order = { id: 7, 'with-dash': true, items: [], meta: { tags: ['a', 'b'] } };
  // Callbacks inside are 'use region' code too.
  for (const item of rows.map((row) => ({ sku: row.sku, qty: row.qty * 2 }))) {
    order.items.push(item);
  }
  const { id, meta: { tags: [first] } } = order;  // patterns
  let a = 1;
  let b = 2;
  [a, b] = [b, a];
  ({ a, b } = { a: a + 10, b: b + 10 });
  // A pattern parameter. map() itself returns a local array, so join it.
  const names = order.items.map(({ sku }) => sku).join();
  return { order, id, first, a, b, names, empty: {}, none: [] };
}

const result = build([{ sku: 'x', qty: 1 }, { sku: 'y', qty: 2 }]);
check('result in the region', isRegion(result) && Region.of(result) === region);
check('nested objects', isRegion(result.order) && isRegion(result.order.meta) &&
      isRegion(result.order.meta.tags) && isRegion(result.order.items[1]));
check('callback literals', result.order.items[1].qty === 4 && result.names === 'x,y');
check('patterns', result.id === 7 && result.first === 'a' && result.a === 12 && result.b === 11);
check('empty literals', isRegion(result.empty) && isRegion(result.none) && result.none.length === 0);
check('string key', result.order['with-dash'] === true);
print(JSON.stringify(result));

// Without the directive nothing changes.
function plain() {
  return { a: [1] };
}
check('plain code', !isRegion(plain()) && !isRegion(plain().a));

// Functions compiled lazily, long after their 'use region' parent ran.
function outer() {
  'use region';
  return function middle() {
    return () => ({ deep: [1, 2, 3] });
  };
}
const inner = outer()();
{
  using _ = region.enter();
  const deep = inner();
  check('lazily compiled inner functions', isRegion(deep) && isRegion(deep.deep));
}
// Without a current region the same code makes plain objects; #{} throws.
{
  const deep = inner();
  check('plain outside a region', !isRegion(deep) && !isRegion(deep.deep) &&
        deep.deep.join() === '1,2,3' && Array.isArray(deep.deep));
  let error = 'no error';
  try {
    #{ a: 1 };
  } catch (e) {
    error = e.message;
  }
  print('#{} outside a region:', error);
  check('#{} needs a current region', error !== 'no error');
}

// Hot code: the same function after the optimizing compilers took it.
function point(x, y) {
  'use region';
  return { x, y, sum: [x + y] };
}
{
  using _ = new Region().enter();
  let total = 0;
  for (let i = 0; i < 100000; i++) total += point(i, 1).sum[0];
  check('hot', total === 100000 * 99999 / 2 + 100000 && isRegion(point(1, 2)));
}
// The same hot code outside a region, and both in one loop.
{
  let total = 0;
  for (let i = 0; i < 100000; i++) total += point(i, 1).sum[0];
  const p = point(3, 4);
  check('hot outside', total === 100000 * 99999 / 2 + 100000 && !isRegion(p) &&
        JSON.stringify(p) === '{"x":3,"y":4,"sum":[7]}');
  const r = new Region();
  let inside = 0;
  for (let i = 0; i < 20000; i++) {
    if (i % 2) {
      using _ = r.enter();
      if (isRegion(point(i, 0))) inside++;
    } else if (isRegion(point(i, 0))) {
      inside = -1e9;
    }
  }
  check('hot, both ways', inside === 10000);
}
// Duplicate keys and constants, as plain objects.
function shapes(v) {
  'use region';
  return { a: v, b: 1, a: 2, c: [1, v, 'x'], d: { e: v } };
}
check('plain duplicates and constants',
      JSON.stringify(shapes(5)) === '{"a":2,"b":1,"c":[1,5,"x"],"d":{"e":5}}');

// Typed arrays are copied in, as by #{}.
{
  'use region';
  using _ = new Region().enter();
  const data = new Float64Array([1, 2]);
  const holder = { data };
  // A block is not a directive prologue: this one is plain code.
  check('directive only at the start', !isRegion(holder));
}
function withTyped() {
  'use region';
  using _ = new Region().enter();
  const data = new Float64Array([1, 2]);
  return { data };
}
check('typed array copied', withTyped().data[1] === 2);

// What #{} and #[] can't create is created as usual and then copied into the
// current region, as region.run() copies its result.
function rest(a, xs, k) {
  'use region';
  return {
    spread: { ...a, more: 1 },
    list: [...xs, 4],
    holes: [1, , 3],
    computed: { [k]: xs.length, 1: 'one' },
    nested: { inner: [...xs] },
  };
}
{
  const plain = rest({ x: 1 }, [1, 2, 3], 'key');
  check('copied forms, plain', !isRegion(plain) && !isRegion(plain.spread) &&
        JSON.stringify(plain) ===
            '{"spread":{"x":1,"more":1},"list":[1,2,3,4],"holes":[1,null,3],' +
            '"computed":{"1":"one","key":3},"nested":{"inner":[1,2,3]}}');
  using _ = new Region().enter();
  const copied = rest({ x: 1 }, [1, 2, 3], 'key');
  check('copied forms, in the region', isRegion(copied) &&
        isRegion(copied.spread) && isRegion(copied.list) &&
        isRegion(copied.nested.inner) && copied.list.join() === '1,2,3,4' &&
        copied.spread.x === 1 && copied.computed.key === 3 &&
        copied.holes.length === 3 && copied.holes[1] === undefined);
}
function method() {
  'use region';
  return { m() { return 1; } };
}
check('a method outside a region', method().m() === 1);
{
  using _ = new Region().enter();
  let error = 'no error';
  try {
    method();
  } catch (e) {
    error = e.message;
  }
  print('a method in a region:', error);
  check('a method cannot be copied', error !== 'no error');
}
for (const body of [
  'const { a, ...rest } = x;',
  '({ a, ...rest } = x);',
  '[, second] = x;',
  '[first, ...others] = x;',
  'for (const [k, v] of x) {}',
  'const f = ({ a = 1, [k]: b }) => a;',
  'return { ...a };',
  'return [1, , 2];',
  'return { get x() { return 1; } };',
  'return { __proto__: null };',
]) {
  const error = syntaxError(body);
  print(body.padEnd(36), error);
  check('allowed', error === 'no error');
}

// A script that starts with the directive.
{
  using _ = new Region().enter();
  const fromScript = (0, eval)(`'use region'; ({ list: [1, 2] })`);
  check('script directive', isRegion(fromScript) && isRegion(fromScript.list));
}

// spawn(): the task source keeps its directive.
const made = spawn(() => {
  'use region';
  const out = new Region();
  using _ = out.enter();
  return { made: ['in', 'a', 'task'] };
}).join();
check('spawn task', isRegion(made) && made.made.join(' ') === 'in a task');

// The current region keeps its id while nothing holds the Region object or
// any object of the region: literals still allocate in it.
function pair(x, y) {
  'use region';
  return { x, y };
}
let kept;
{
  using _ = new Region().enter();
  for (let i = 0; i < 1000; i++) pair(i, 1);
  gc(); gc(); gc();
  kept = pair(1, 2);
}
check('entered region keeps its id', Region.of(kept) !== new Region());
print('done');

// d8 --harmony-region-literals --verify-heap use-region.js
// 'use region': {} and [] in the function, and in the functions inside it,
// are #{} and #[]. Destructuring patterns stay patterns.
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
try {
  inner();
  check('needs a current region', false);
} catch (e) {
  print('outside a region:', e.message);
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

// What #{} and #[] do not allow is a syntax error, but fine in a pattern.
for (const body of [
  'return { ...a };',
  'return [...a];',
  'return [1, , 2];',
  'return { m() {} };',
  'return { get x() { return 1; } };',
  'return { [k]: 1 };',
  'return { 1: "one" };',
  'return { __proto__: null };',
  'return () => ({ ...a });',
]) {
  print(body.padEnd(36), syntaxError(body));
}
for (const body of [
  'const { a, ...rest } = x;',
  '({ a, ...rest } = x);',
  '[, second] = x;',
  '[first, ...others] = x;',
  'for (const [k, v] of x) {}',
  'const f = ({ a = 1, [k]: b }) => a;',
  'return { "__proto__": 1 }.x;',
]) {
  const error = syntaxError(body);
  print(body.padEnd(36), error);
  if (body.includes('__proto__')) continue;
  check('pattern allowed', error === 'no error');
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
print('done');

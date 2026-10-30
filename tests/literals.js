// d8 --harmony-region-literals --module --allow-natives-syntax --verify-heap literals.js
// #{} and #[] create objects directly in the current region, without a copy.
const expectError = (name, fn) => {
  try {
    print(`${name}: NO ERROR ->`, fn());
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};

const region = new Region();
let shop;
{
  using _ = region.enter();
  const owner = 'shop';
  shop = #{
    owner,
    'opened-at': 9,
    total: 0,
    orders: #[],
    settings: #{ currency: 'EUR', tax: 0.2 },
  };
  for (let id = 1; id <= 3; id++) {
    shop.orders.push(#{ id, price: id * 10, tags: #['new', 'paid'] });
    shop.total += id * 10;
  }
}
print('in region:', Region.of(shop).id === region.id, Region.of(shop.orders[2].tags).id === region.id);
print('json:', JSON.stringify(shop));
print('same keys, same map:', %HaveSameMap(shop.orders[0], shop.orders[2]));

expectError('no current region', () => #{ a: 1 });
{
  using _ = region.enter();
  expectError('plain object inside', () => #{ nested: { a: 1 } });
  expectError('plain array inside', () => #[[1, 2]]);
  expectError('other region inside', () => #{ other: new Region().run(() => ({})) });
  print('typed array is copied:', #{ bytes: new Uint8Array([1, 2]) }.bytes[1]);
  expectError('new property', () => {
    const o = #{ a: 1 };
    o.b = 2;
  });
}

// Functions compiled lazily (preparsed first) see the literals too.
function makeOrder(id) {
  return #{ id, items: #[id, id + 1] };
}
{
  using _ = region.enter();
  print('lazy function:', JSON.stringify(makeOrder(7)));
}

// Hot code: literals with one shape keep inline caches monomorphic.
{
  using _ = region.enter();
  const points = #[];
  for (let i = 0; i < 200000; i++) points.push(#{ x: i, y: i * 2 });
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].x + points[i].y;
  print('hot reads:', sum);
}

// In a task: enter the region that came with it.
const count = await spawn(() => {
  using _ = Region.of(shop).enter();
  shop.orders.push(#{ id: 4, price: 40, tags: #[] });
  return shop.orders.length;
});
print('task appended:', count, shop.orders[3].price);

// Syntax errors.
for (const source of ['#{ ...x }', '#[ , ]', '#{ a() {} }', '#{ [k]: 1 }', '#[ ...x ]']) {
  expectError(source, () => new Function(source));
}

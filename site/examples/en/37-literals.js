// d8-flags: --module
// Literals #{} and #[]: the object or array is created directly in the current region, without a copy.
const region = new Region();
let shop;
{
  using _ = region.enter();
  const currency = 'EUR';
  shop = #{ currency, 'opened-at': 9, total: 0, orders: #[] };
  for (let id = 1; id <= 3; id++) {
    shop.orders.push(#{ id, price: id * 10, tags: #['new'] });
    shop.total += id * 10;
  }
}
print('in the region:', Region.of(shop.orders[2].tags).id === region.id, '| total:', shop.total);
print(JSON.stringify(shop.orders[0]));

// Inside run() the region is current too.
const point = region.run(() => #{ x: 1, y: 2 });
print('from run:', Region.of(point).id === region.id);

const tryIt = (label, fn) => {
  try {
    fn();
    print(`${label}: works`);
  } catch (e) {
    print(`${label}: ${e.name}: ${e.message}`);
  }
};
tryIt('no current region', () => #{ a: 1 });
{
  using _ = region.enter();
  tryIt('#{} inside #{}', () => #{ nested: #{ a: 1 } });
  tryIt('plain object inside', () => #{ nested: { a: 1 } });
}

// A spawn task has no current region: enter the region that arrived with the data.
const count = await spawn(() => {
  using _ = Region.of(shop).enter();
  shop.orders.push(#{ id: 4, price: 40, tags: #[] });
  return shop.orders.length;
});
print('after the task:', count, '| last order:', JSON.stringify(shop.orders[3]));

// Spread, computed keys, methods and holes are a syntax error.
for (const source of ['#{ ...x }', '#{ [key]: 1 }', '#{ total() {} }', '#[1, , 3]']) {
  tryIt(source, () => new Function(source));
}

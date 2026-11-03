// d8-flags: --module
// Writing directly into a region: inside region.enter() the literals #{} and #[] create
// objects right in it, and arrays grow.
const region = new Region();
let shop;
{
  using _ = region.enter();
  shop = #{ orders: #[], total: 0 };
  for (let id = 1; id <= 3; id++) {
    shop.orders.push(#{ id, price: id * 10, tags: #['new'] });
    shop.total += id * 10;
  }
}
print('orders:', shop.orders.length, '| total:', shop.total);
print('all in one region:', Region.of(shop.orders[2]).id === region.id);

try {
  shop.orders.push({ id: 4 });
} catch (e) {
  print('plain object:', String(e));
}

// The whole region moves into the task and back. A task has no current region:
// enter it explicitly, or let run copy what it returns into the region.
const count = await spawn(() => {
  const r = Region.of(shop);
  {
    using _ = r.enter();
    shop.orders.push(#{ id: 4, price: 40, tags: #[] });
  }
  shop.orders.push(r.run(() => ({ id: 5, price: 50, tags: ['from run'] })));
  return shop.orders.length;
});
print('after the task:', count, '| last order:', JSON.stringify(shop.orders[4]));

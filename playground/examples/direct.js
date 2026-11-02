// Writing straight into a region, without run(): region.object() and
// region.array() create objects in it, arrays grow.
const region = new Region();
const shop = region.object({ orders: region.array(), total: 0 });
for (let id = 1; id <= 3; id++) {
  shop.orders.push(region.object({ id, price: id * 10, tags: region.array('new') }));
  shop.total += id * 10;
}
print('orders:', shop.orders.length, 'total:', shop.total);

// The whole region moves to a task and back; inside, name the region.
const count = await spawn(() => {
  const r = Region.of(shop);
  shop.orders.push(r.object({ id: 4, price: 40, tags: r.array() }));
  return shop.orders.length;
});
print('after the task:', count, shop.orders[3].price);

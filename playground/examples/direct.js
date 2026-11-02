// Adding to a region as you go: run() copies what it returns into the
// region, and region arrays grow. With --harmony-regions, #{} and #[]
// inside region.enter() create objects in it without the copy.
/** @typedef {{ id: number, price: number, tags: string[] }} Order */
const region = new Region();
const shop = region.run(() => ({ orders: /** @type {Order[]} */ ([]), total: 0 }));
for (let id = 1; id <= 3; id++) {
  shop.orders.push(region.run(() => ({ id, price: id * 10, tags: ['new'] })));
  shop.total += id * 10;
}
print('orders:', shop.orders.length, 'total:', shop.total);

// The whole region moves to a task and back; inside, name the region.
const count = await spawn(() => {
  const r = Region.of(shop);
  shop.orders.push(r.run(() => ({ id: 4, price: 40, tags: [] })));
  return shop.orders.length;
});
print('after the task:', count, shop.orders[3].price);

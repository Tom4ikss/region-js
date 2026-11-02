// d8-flags: --module
// Писать прямо в регион: region.object() и region.array() создают объекты
// в нём, массивы растут.
const region = new Region();
const shop = region.object({ orders: region.array(), total: 0 });
for (let id = 1; id <= 3; id++) {
  shop.orders.push(region.object({ id, price: id * 10, tags: region.array('новый') }));
  shop.total += id * 10;
}
print('заказов:', shop.orders.length, '| сумма:', shop.total);
print('всё в одном регионе:', Region.of(shop.orders[2]).id === region.id);

try {
  shop.orders.push({ id: 4 });
} catch (e) {
  print('обычный объект:', String(e));
}

// Регион целиком уезжает в задачу и обратно; внутри задачи регион называют явно.
const count = await spawn(() => {
  const r = Region.of(shop);
  shop.orders.push(r.object({ id: 4, price: 40, tags: r.array() }));
  return shop.orders.length;
});
print('после задачи:', count, '| последний заказ:', JSON.stringify(shop.orders[3]));

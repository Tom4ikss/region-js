// d8-flags: --module
// Писать прямо в регион: enter() делает его текущим, Region.object() и
// Region.array() создают объекты в нём, массивы растут.
const region = new Region();
let shop;
{
  using _ = region.enter();
  shop = Region.object({ orders: Region.array(), total: 0 });
  for (let id = 1; id <= 3; id++) {
    shop.orders.push(Region.object({ id, price: id * 10, tags: Region.array('новый') }));
    shop.total += id * 10;
  }
}
print('заказов:', shop.orders.length, '| сумма:', shop.total);
print('всё в одном регионе:', Region.of(shop.orders[2]).id === region.id);

try {
  shop.orders.push({ id: 4 });
} catch (e) {
  print('обычный объект:', e.message);
}

// Регион целиком уезжает в задачу и обратно; внутри задачи регион называют явно.
const count = await spawn(() => {
  const r = Region.of(shop);
  shop.orders.push(r.object({ id: 4, price: 40, tags: r.array() }));
  return shop.orders.length;
});
print('после задачи:', count, '| последний заказ:', JSON.stringify(shop.orders[3]));

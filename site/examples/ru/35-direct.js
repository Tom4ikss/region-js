// d8-flags: --module
// Писать прямо в регион: внутри region.enter() литералы #{} и #[] создают
// объекты сразу в нём, массивы растут.
const region = new Region();
let shop;
{
  using _ = region.enter();
  shop = #{ orders: #[], total: 0 };
  for (let id = 1; id <= 3; id++) {
    shop.orders.push(#{ id, price: id * 10, tags: #['новый'] });
    shop.total += id * 10;
  }
}
print('заказов:', shop.orders.length, '| сумма:', shop.total);
print('всё в одном регионе:', Region.of(shop.orders[2]).id === region.id);

try {
  shop.orders.push({ id: 4 });
} catch (e) {
  print('обычный объект:', String(e));
}

// Регион целиком уезжает в задачу и обратно. В задаче текущего региона нет:
// в него входят явно, или run копирует в регион то, что вернул.
const count = await spawn(() => {
  const r = Region.of(shop);
  {
    using _ = r.enter();
    shop.orders.push(#{ id: 4, price: 40, tags: #[] });
  }
  shop.orders.push(r.run(() => ({ id: 5, price: 50, tags: ['из run'] })));
  return shop.orders.length;
});
print('после задачи:', count, '| последний заказ:', JSON.stringify(shop.orders[4]));

// d8-flags: --module
// Ссылка из региона на объект своего потока: Region.localRef.
const cache = new Map([['sku1', 120]]);

const region = new Region();
const order = region.run(() => ({ sku: 'sku1', count: 2, prices: Region.localRef(cache) }));

// В своём потоке deref() возвращает сам объект.
print('здесь:', order.prices.local, order.prices.deref().get(order.sku) * order.count);

// Задача получает регион целиком, а Map остаётся тут: в задаче ручка есть,
// но разыменовать её нельзя.
const inTask = await spawn(() => {
  try {
    return order.prices.deref().size;
  } catch (e) {
    return `${order.prices.local} ${e.name} ${e.reason}`;
  }
});
print('в задаче:', inTask);

// После задачи регион снова здесь, и ручка снова работает.
print('снова здесь:', order.prices.deref() === cache);

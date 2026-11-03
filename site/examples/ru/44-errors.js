// d8-flags: --module
// OwnershipError: класс, поля region и reason, место события в тексте.
const orders = new Channel(1);
const region = new Region();
const order = region.run(() => ({ id: 7, total: 120 }));
await orders.send(order);           // регион уехал в канал

try {
  print(order.total);
} catch (e) {
  print(e instanceof OwnershipError, e instanceof TypeError, e.reason);
  print(e.message);
}

// Ошибка из задачи приходит со стеком задачи, а не очереди ответов.
function check(order) {
  if (order.total > 100) throw new RangeError('order ' + order.id + ' is too big');
}
try {
  await spawn((orders) => {
    return orders.recv().then(({ value }) => check(value));
  }, orders);
} catch (e) {
  print(e.stack);
}

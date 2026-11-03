// d8-flags: --module
// OwnershipError: the class, the region and reason fields, the event location in the text.
const orders = new Channel(1);
const region = new Region();
const order = region.run(() => ({ id: 7, total: 120 }));
await orders.send(order);           // the region went into the channel

try {
  print(order.total);
} catch (e) {
  print(e instanceof OwnershipError, e instanceof TypeError, e.reason);
  print(e.message);
}

// An error from a task comes with the task's stack, not the reply queue's.
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

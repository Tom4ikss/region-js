// A pipeline in the style of Go: one task produces orders, a pool of tasks
// prices them, main collects the totals. Run with Cmd+Shift+B.

/** @type {Channel<{ id: number, items: number[] }>} */
const orders = new Channel(8);
/** @type {Channel<{ id: number, total: number }>} */
const priced = new Channel(8);

const producer = spawn(async () => {
  for (let id = 0; id < 12; id++) {
    // Built in a region, so sending it is a move, not a copy.
    await orders.send(new Region().run(() => ({ id, items: [id, id * 2, 3] })));
  }
  orders.close();
});

const pricers = [0, 1, 2].map(() =>
  spawn(async () => {
    let count = 0;
    for await (const order of orders) {
      const total = order.items.reduce((sum, price) => sum + price, 0);
      await priced.send({ id: order.id, total });
      count++;
    }
    return count;
  }),
);

const totals = [];
for (let i = 0; i < 12; i++) {
  const { value } = await priced.recv();
  if (value) totals[value.id] = value.total;
}
await producer;
print('totals:', totals.join(' '));
print('orders per pricer:', (await Promise.all(pricers)).join(' '));

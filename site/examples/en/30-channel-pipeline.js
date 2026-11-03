// d8-flags: --module
// A pipeline: one task produces orders, three price them, the main thread collects the results.
const orders = new Channel(8);
const priced = new Channel(8);

const producer = spawn(async () => {
  for (let id = 0; id < 12; id++) {
    await orders.send(new Region().run(() => ({ id, prices: [id, id * 2, 3] })));
  }
  orders.close();
});

const pricers = [0, 1, 2].map(() => spawn(async () => {
  let count = 0;
  for await (const order of orders) {
    const total = order.prices.reduce((sum, price) => sum + price, 0);
    await priced.send({ id: order.id, total });
    count++;
  }
  return count;
}));

const totals = [];
for (let i = 0; i < 12; i++) {
  const { value } = await priced.recv();
  totals[value.id] = value.total;
}
await producer;
const counts = await Promise.all(pricers);
print('totals:', totals.join(' '));
print('priced in all:', counts.reduce((a, b) => a + b, 0));

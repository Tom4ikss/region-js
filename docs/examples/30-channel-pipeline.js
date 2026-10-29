// d8-flags: --module
// Конвейер: одна задача производит заказы, три их считают, главный поток собирает.
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
print('суммы:', totals.join(' '));
print('всего посчитано:', counts.reduce((a, b) => a + b, 0));

// d8-flags: --module
// Конвейер в spawn.scope: производитель, три считающие задачи, сборщик.
const run = (bad) => spawn.scope(async (s) => {
  const raw = s.channel(2);
  const priced = s.channel(2);
  s.spawn(async (raw, bad) => {
    for (let b = 0; b < 12; b++) {
      await raw.send(new Region().run(() => ({ batch: b, qty: b === bad ? -1 : 2, price: 10 })));
    }
    raw.close();
  }, raw, bad);
  const pricers = [0, 1, 2].map(() => s.spawn(async (raw, priced) => {
    for await (const order of raw) {
      if (order.qty < 0) throw new RangeError('batch ' + order.batch + ': negative qty');
      await priced.send(order.qty * order.price);
    }
  }, raw, priced));
  s.closeAfter(priced, pricers);   // выход закроет последняя считающая задача
  let sum = 0;
  for await (const total of priced) sum += total;
  return sum;
});

print('все пачки:', await run(-1));
try {
  await run(5);
} catch (e) {
  // Ошибка стадии, а не DeadlockError: блок отменил остальные задачи
  // и закрыл свои каналы.
  print(e.name + ':', e.message);
}

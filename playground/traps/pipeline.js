// Конвейер из трёх стадий на каналах: производитель делает пачки заказов в
// регионах, несколько задач их считают, главный поток собирает итог.
// ./run.sh pipeline.js [first|fixed|shared-stats|use-after-send|close-race|of-received]
const VARIANT = globalThis.arguments?.[0] ?? 'first';
const WORKERS = 3;
const BATCHES = 12;

const makeBatch = (0, eval)(`'use region'; (b) => {
  const orders = [];
  for (let i = 0; i < 50; i++) {
    orders.push({ id: b * 50 + i, qty: 1 + (i % 4), price: 10 + (i % 7), status: 'new' });
  }
  return { batch: b, orders };
}`);

const raw = new Channel(2);       // производитель упирается в ёмкость
const priced = new Channel(2);
const stats = { batches: 0, orders: 0 };   // «общая» статистика

const producer = spawn(async (raw) => {
  for (let b = 0; b < BATCHES; b++) {
    const batch = new Region().run(() => makeBatch(b));
    await raw.send(batch);
    if (VARIANT === 'use-after-send') {
      // Первая попытка: залогировать то, что уже отправили.
      print('отправлена пачка', batch.batch, 'заказов', batch.orders.length);
    }
  }
  raw.close();
}, raw);

const pricers = Array.from({ length: WORKERS }, (_, w) => spawn(async (raw, priced, stats) => {
  for await (const batch of raw) {
    let total = 0;
    for (const order of batch.orders) {
      if (VARIANT === 'first') {
        order.total = order.qty * order.price;   // новое поле у заказа
      }
      total += order.qty * order.price;
      order.status = 'priced';
    }
    stats.batches++;                              // копия, а не общая статистика
    stats.orders += batch.orders.length;
    if (VARIANT === 'first' || VARIANT === 'close-race') {
      await priced.send(batch);
    } else {
      await priced.send(new Region().run(() => ({ batch: batch.batch, total, orders: batch.orders.length })));
    }
  }
  if (VARIANT === 'first' || VARIANT === 'close-race') {
    priced.close();                               // «я закончил — закрываю»
  }
  return stats;
}, raw, priced, stats));

if (VARIANT !== 'first' && VARIANT !== 'close-race') {
  // Закрыть выход, когда все считающие закончили.
  Promise.all(pricers).then(() => priced.close());
}

const totals = [];
let received = 0;
try {
  for await (const item of priced) {
    received++;
    if (VARIANT === 'of-received') {
      const region = Region.of(item);
      print('из канала: регион', region.id, 'owner', region.owner, 'frozen', region.frozen);
      region.free();   // «освобождаем, раз дочитали»
    }
    totals[item.batch] = item.total ?? item.orders.reduce((s, o) => s + o.qty * o.price, 0);
  }
} catch (e) {
  print('главный поток:', e.name + ':', e.message);
}
await producer.then(() => {}, (e) => print('производитель:', e.name + ':', e.message));
const results = await Promise.allSettled(pricers);
for (const r of results) {
  if (r.status === 'rejected') print('считающая задача:', r.reason.name + ':', r.reason.message);
}
print('получено пачек:', received, 'из', BATCHES);
print('сумма:', totals.reduce((a, b) => a + b, 0));
print('stats в главном потоке:', JSON.stringify(stats));
if (VARIANT === 'shared-stats' || VARIANT === 'fixed') {
  print('stats из задач:', results.map((r) => r.status === 'fulfilled' ? JSON.stringify(r.value) : 'ошибка').join(' '));
}

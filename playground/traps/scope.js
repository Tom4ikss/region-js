// Те же ловушки через spawn.scope(): конвейер с падающей стадией (п. 2), гонка
// закрытия канала (п. 3), отказ на первой ошибке (п. 17) и вложенный spawn без
// await (п. 16).
// ./run.sh scope.js [pipeline|close-race|close-fixed|fail-fast|floating-child]
const VARIANT = globalThis.arguments?.[0] ?? 'pipeline';

const makeBatch = (b) => new Region().run(() => ({
  batch: b,
  orders: Array.from({ length: 50 }, (_, i) => ({ qty: 1 + (i % 4), price: 10 + (i % 7) })),
}));

const report = async (what, promise) => {
  try {
    print(what + ':', JSON.stringify(await promise));
  } catch (e) {
    print(what + ':', e.name + ':', e.message);
  }
};

if (VARIANT === 'pipeline' || VARIANT === 'close-race' || VARIANT === 'close-fixed') {
  await report('итог', spawn.scope(async (s) => {
    const raw = s.channel(2);
    const priced = s.channel(2);
    s.spawn(async (raw) => {
      for (let b = 0; b < 12; b++) await raw.send(makeBatch(b));
      raw.close();
    }, raw);
    const pricers = [0, 1, 2].map(() => s.spawn(async (raw, priced, VARIANT) => {
      for await (const batch of raw) {
        let total = 0;
        for (const order of batch.orders) {
          if (VARIANT === 'pipeline') order.total = order.qty * order.price;  // новое поле
          total += order.qty * order.price;
        }
        await priced.send(new Region().run(() => ({ batch: batch.batch, total })));
      }
      if (VARIANT === 'close-race') priced.close();  // «я закончил — закрываю»
    }, raw, priced, VARIANT));
    // Выход закрывается, когда закончили все считающие.
    if (VARIANT !== 'close-race') s.closeAfter(priced, pricers);
    let received = 0;
    for await (const item of priced) received++;
    return 'получено пачек ' + received + ' из 12';
  }));
}

if (VARIANT === 'fail-fast') {
  const own = Array.from({ length: 6 }, (_, s) => new Region().run(() => ({
    name: 'shop' + s,
    months: Array.from({ length: 12 }, (_, m) => (s === 4 && m === 7 ? -1 : 100 + m)),
    total: 0,
  })));
  await report('отчёт', spawn.scope(async (s) => {
    for (const shop of own) {
      s.spawn(async (shop) => spawn.scope(async (inner) => {
        const parts = [0, 1, 2, 3].map((q) => inner.spawn((months, q) => {
          let sum = 0;
          for (let m = q * 3; m < q * 3 + 3; m++) {
            if (months[m] < 0) throw new RangeError('bad month ' + m);
            sum += months[m];
          }
          return sum;
        }, [...shop.months], q));   // копия: регион магазина у этой задачи
        shop.total = (await Promise.all(parts)).reduce((a, b) => a + b, 0);
      }), shop);
    }
  }));
  // Блок дождался всех задач: регионы снова здесь.
  for (const shop of own) print(shop.name, shop.total);
}

if (VARIANT === 'floating-child') {
  const own = new Region().run(() => ({ log: [] }));
  await report('родитель', spawn.scope(async (s) => {
    s.spawn(async (own) => spawn.scope(async (inner) => {
      inner.spawn((own) => { own.log.push('child'); }, own);   // без await
      own.log.push('parent');
    }), own);
  }));
  print('log:', own.log.join(', '));
}

// Кэш цен: замороженный регион, который читают задачи, а главный поток время от
// времени перестраивает (thaw, обновить, freeze). Чтения асинхронные.
// ./run.sh cache.js [first|wait|swap|borrow-await|borrow-await-wait|channel-read|
//                    rwlock|rwlock-await]
const VARIANT = globalThis.arguments?.[0] ?? 'first';

const sleep = (ms) => new Promise((resolve) => {
  const end = performance.now() + ms;
  const tick = () => (performance.now() >= end ? resolve() : setTimeout(tick, 0));
  tick();
});

const build = (version) => new Region().run(() => {
  const prices = {};
  for (let i = 0; i < 100; i++) prices['sku' + i] = 10 + i + version;
  return { version, prices };
});

let cache = build(0);
Region.of(cache).freeze();

// Запрос: спросить цену в кэше, «сходить в базу», вернуть цену и версию.
const lookup = async (cache, sku) => {
  const price = cache.prices[sku];
  await sleep(5);                          // асинхронная работа посередине
  return cache.version + ':' + price;      // ещё одно чтение после await
};

const refresh = async (version) => {
  if (VARIANT === 'swap' || VARIANT === 'channel-read') {
    // Перестроить в новом регионе и подменить переменную.
    const next = build(version);
    Region.of(next).freeze();
    cache = next;
    return;
  }
  const region = Region.of(cache);
  if (VARIANT.endsWith('wait')) {
    await region.thawWhenFree();           // ждать, пока читатели уйдут
  } else for (let attempt = 0; ; attempt++) {
    try {
      region.thaw();
      break;
    } catch (e) {
      if (attempt === 0) print('thaw:', e.name + ':', e.message);
      await sleep(1);
    }
  }
  cache.version = version;
  for (let i = 0; i < 100; i++) cache.prices['sku' + i] += 1;
  region.freeze();
};

if (VARIANT === 'first' || VARIANT === 'wait' || VARIANT === 'swap') {
  const reads = [];
  for (let round = 1; round <= 5; round++) {
    for (let i = 0; i < 8; i++) reads.push(spawn(lookup, cache, 'sku' + i));
    await refresh(round);
  }
  const res = await Promise.allSettled(reads);
  const seen = {};
  for (const r of res) {
    const key = r.status === 'fulfilled' ? 'версия ' + r.value.split(':')[0] : r.reason.name + ': ' + r.reason.message;
    seen[key] = (seen[key] ?? 0) + 1;
  }
  print('ответы:', JSON.stringify(seen));
}

if (VARIANT === 'borrow-await' || VARIANT === 'borrow-await-wait') {
  // Главный поток сам читает кэш под билетом и ждёт посередине.
  const region = Region.of(cache);
  const handler = async () => {
    using b = region.borrow();
    const p = cache.prices.sku1;
    await sleep(200);                       // билет держится всё это время
    return p;
  };
  const h = handler();
  const t0 = performance.now();
  await refresh(1);
  print('refresh ждал', Math.round(performance.now() - t0), 'мс; handler вернул', await h);
}

if (VARIANT === 'channel-read') {
  // Кэш раздаётся через канал, а не захватом.
  const ch = new Channel(4);
  const reader = spawn(async (ch) => {
    const { value } = await ch.recv();
    return value.prices.sku3;              // замороженный объект из канала без билета
  }, ch);
  await ch.send(cache);
  try { print('reader:', await reader); } catch (e) { print('reader:', e.name + ':', e.message); }
}

if (VARIANT === 'rwlock' || VARIANT === 'rwlock-await') {
  const lock = new RwLock(build(0));
  const readers = [];
  for (let i = 0; i < 8; i++) {
    readers.push(spawn(async (lock, i) => {
      if (VARIANT === 'rwlock-await') {
        using r = await lock.read();
        await sleep(30);                    // держим read-лок через await
        return r.value.version;
      }
      let prices;
      {
        using r = await lock.read();
        prices = r.value.prices;            // «вынесем ссылку из-под лока»
      }
      await sleep(5);
      return prices['sku' + i];
    }, lock, i));
  }
  const t0 = performance.now();
  {
    using w = await lock.write();
    w.value.version = 1;
  }
  print('писатель ждал', Math.round(performance.now() - t0), 'мс');
  const res = await Promise.allSettled(readers);
  print('читатели:', res.map((r) => (r.status === 'fulfilled' ? r.value : r.reason.message)).join(' | '));
}

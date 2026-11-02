// Fan-out/fan-in: отчёт по магазинам считают задачи, каждая по своему магазину,
// внутри — вложенные задачи по месяцам. Часть магазинов с битыми данными.
// ./run.sh fanout.js [first|all-fail-fast|two-tasks|floating-child|joinset|plain-back|classes|forgot-await]
const VARIANT = globalThis.arguments?.[0] ?? 'first';

const sleep = (ms) => new Promise((resolve) => {
  const end = performance.now() + ms;
  const tick = () => (performance.now() >= end ? resolve() : setTimeout(tick, 0));
  tick();
});

const region = new Region();
const shops = region.run(() => Array.from({ length: 6 }, (_, s) => ({
  name: 'shop' + s,
  months: Array.from({ length: 12 }, (_, m) => (s === 4 && m === 7 ? -1 : 100 + s * 10 + m)),
  total: 0,
})));

const summarize = async (shop) => {
  const parts = await Promise.all([0, 1, 2, 3].map((q) => spawn((months, q) => {
    let sum = 0;
    for (let m = q * 3; m < q * 3 + 3; m++) {
      if (months[m] < 0) throw new RangeError('bad month ' + m);
      sum += months[m];
    }
    return sum;
  }, shop.months, q)));
  shop.total = parts.reduce((a, b) => a + b, 0);
  return shop.total;
};

if (VARIANT === 'first') {
  // Первая попытка: каждой задаче — свой магазин из общего массива.
  const totals = await Promise.allSettled(shops.map((shop) => spawn(summarize, shop)));
  print(totals.map((t) => (t.status === 'fulfilled' ? t.value : t.reason.name + ': ' + t.reason.message)).join('\n'));
}

if (VARIANT === 'two-tasks') {
  const a = spawn((shops) => { shops[0].total = 1; return 'a'; }, shops);
  const b = spawn((shops) => { shops[1].total = 2; return 'b'; }, shops);
  print(JSON.stringify(await Promise.allSettled([a, b]).then((r) => r.map((x) => x.status === 'fulfilled' ? x.value : x.reason.message))));
}

if (VARIANT === 'all-fail-fast') {
  // Весь массив — одной задаче на магазин? Нельзя, поэтому копия в свой регион на каждый магазин.
  const own = shops.map((s) => new Region().run(() => ({ name: s.name, months: [...s.months], total: 0 })));
  try {
    await Promise.all(own.map((shop) => spawn(summarize, shop)));
  } catch (e) {
    print('Promise.all:', e.name + ':', e.message);
  }
  // Сразу показать то, что успели посчитать.
  for (const shop of own) {
    try { print(shop.name, shop.total); } catch (e) { print(shop.name, '→', e.message); }
  }
}

if (VARIANT === 'floating-child') {
  const own = new Region().run(() => ({ name: 'x', log: [] }));
  const parent = spawn(async (own) => {
    spawn(async (own) => { await sleep(30); own.log.push('child'); }, own);   // без await
    own.log.push('parent');
    return 'parent done';
  }, own);
  try { print(await parent); } catch (e) { print('parent:', e.name + ':', e.message); }
  try { print('log:', own.log.join(',')); } catch (e) { print('log:', e.message); }
  await sleep(60);
  try { print('log позже:', own.log.join(',')); } catch (e) { print('log позже:', e.message); }
}

if (VARIANT === 'joinset') {
  const own = shops.map((s) => new Region().run(() => ({ name: s.name, months: [...s.months], total: 0 })));
  {
    using set = new JoinSet();
    for (const shop of own) set.spawn(summarize, shop);
    const first = await set.next();
    print('первый результат:', first.status, first.value ?? first.reason?.message);
  }   // остальные отменены
  await sleep(50);
  for (const shop of own) {
    try { print(shop.name, shop.total); } catch (e) { print(shop.name, '→', e.message); }
  }
}

if (VARIANT === 'plain-back') {
  const report = { done: [], errors: 0 };
  await Promise.all([0, 1, 2].map((i) => spawn((report, i) => { report.done.push(i); }, report, i)));
  print('report после задач:', JSON.stringify(report));
}

if (VARIANT === 'classes') {
  class Money { constructor(v) { this.v = v; } add(o) { return new Money(this.v + o.v); } }
  for (const [label, value] of [['class', new Money(5)], ['Map', new Map([[1, 2]])], ['Date', new Date(0)],
                                ['function', () => 1], ['Set', new Set([1])], ['undefined field', { a: undefined }]]) {
    try { print(label + ':', JSON.stringify(await spawn((v) => typeof v === 'object' ? Object.keys(v).join() + '|' + String(v) : typeof v, value))); }
    catch (e) { print(label + ':', e.name + ':', e.message); }
  }
}

if (VARIANT === 'forgot-await') {
  const own = new Region().run(() => ({ total: 0 }));
  spawn((own) => { own.total = 42; }, own);   // забыли await
  try { print('total:', own.total); } catch (e) { print('total:', e.name + ':', e.message); }
}

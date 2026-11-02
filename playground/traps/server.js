// Сервер на минималках: запросы приходят в канал, каждый обрабатывает задача
// spawn с таймаутом, общее состояние (счётчики и журнал) лежит в RwLock.
// ./run.sh server.js [first|lock-await|half-write|shield|abort-region|region-busy|check-then-use]
const VARIANT = globalThis.arguments?.[0] ?? 'first';

const sleep = (ms) => new Promise((resolve) => {
  const end = performance.now() + ms;
  const tick = () => (performance.now() >= end ? resolve() : setTimeout(tick, 0));
  tick();
});

const state = new RwLock({ served: 0, failed: 0, inFlight: 0, log: [] });
const requests = new Channel(16);

// Клиенты: двадцать запросов, некоторые «тяжёлые».
const client = spawn(async (requests) => {
  for (let id = 0; id < 20; id++) {
    await requests.send({ id, path: id % 5 === 0 ? '/report' : '/item', cost: id % 5 === 0 ? 200 : 5 });
  }
  requests.close();
}, requests);

const handle = async (req, state) => {
  // Отметить, что запрос в работе, сделать работу, отметить результат.
  if (VARIANT === 'lock-await') {
    using g = await state.write();
    g.value.inFlight++;
    await sleep(req.cost);              // работа под локом
    g.value.inFlight--;
    g.value.served++;
    return req.id;
  }
  {
    using g = await state.write();
    g.value.inFlight++;
  }
  if (VARIANT === 'shield') {
    // Уборка под spawn.shield(): отмена её не прерывает.
    try {
      await sleep(req.cost);
    } finally {
      await spawn.shield(async () => {
        using g = await state.write();
        g.value.inFlight--;
      });
    }
    using g = await state.write();
    g.value.served++;
    return req.id;
  }
  if (VARIANT === 'half-write') {
    using g = await state.write();
    g.value.log.push('start ' + req.id);
    await sleep(req.cost);              // отмена приходит сюда
    g.value.log.push('done ' + req.id);
    g.value.inFlight--;
    g.value.served++;
    return req.id;
  }
  const end = performance.now() + req.cost;
  while (performance.now() < end) {
    if (spawn.aborted()) throw new Error('aborted in loop');
  }
  using g = await state.write();
  g.value.inFlight--;
  g.value.served++;
  return req.id;
};

const handles = [];
for await (const req of requests) {
  const task = spawn(handle, req, state).timeout(50);
  handles.push(task);
  if (VARIANT === 'first') {
    // Первая попытка: «ответить» сразу, не дожидаясь задачи.
    task.then((id) => print('ответ', id));
  }
}
await client;
const outcomes = await Promise.allSettled(handles);
const errors = {};
for (const o of outcomes) {
  if (o.status === 'rejected') errors[o.reason.name + ': ' + o.reason.message] = (errors[o.reason.name + ': ' + o.reason.message] ?? 0) + 1;
}
print('ошибки задач:', JSON.stringify(errors));
{
  using r = await state.read();
  print('served', r.value.served, 'inFlight', r.value.inFlight, 'log', r.value.log.length,
        r.value.log.length ? '(последние: ' + r.value.log.slice(-4).join(', ') + ')' : '');
}

if (VARIANT === 'abort-region') {
  // Регион, отданный задаче, которую отменили на полпути.
  const region = new Region();
  const doc = region.run(() => ({ title: 'draft', words: 0, saved: false }));
  const t = spawn(async (doc) => {
    doc.title = 'final';
    await sleep(100);
    doc.words = 1000;
    doc.saved = true;
  }, doc).timeout(20);
  try { await t; } catch (e) { print('задача:', e.name); }
  print('документ после отмены:', JSON.stringify(doc));
}

if (VARIANT === 'region-busy') {
  // Пока задача работает с регионом, другой асинхронный код этого потока к нему лезет.
  const region = new Region();
  const session = region.run(() => ({ user: 'ann', hits: 0 }));
  const bg = spawn(async (session) => { for (let i = 0; i < 5; i++) { session.hits++; await sleep(10); } }, session);
  const onTick = async () => { await sleep(15); return session.hits; };
  try { print('тик видит hits:', await onTick()); } catch (e) { print('тик:', e.name + ':', e.message); }
  await bg;
  print('после задачи hits:', session.hits);
}

if (VARIANT === 'check-then-use') {
  const region = new Region();
  const cfg = region.run(() => ({ limit: 10 }));
  region.freeze();
  const reader = async () => {
    if (region.frozen) {                // «заморожен — значит можно читать без записи»
      await sleep(20);
      using b = region.borrow();
      return cfg.limit;
    }
  };
  const p = reader();
  region.thaw();
  cfg.limit = 20;
  setTimeout(() => region.freeze(), 0);
  try { print('reader:', await p); } catch (e) { print('reader:', e.name + ':', e.message); }
}

// d8-flags: --module
// Отмена прерывает обычный await, писатель, отменённый под локом, отравляет
// лок, а уборку под spawn.shield() отмена не прерывает.
const sleep = (ms) => new Promise((resolve) => {
  const end = performance.now() + ms;
  const tick = () => (performance.now() >= end ? resolve() : setTimeout(tick, 0));
  tick();
});

const doc = new Region().run(() => ({ title: '', words: 0 }));
try {
  await spawn(async (doc) => {
    doc.title = 'final';
    await sleep(1000);         // таймаут прерывает это ожидание
    doc.words = 1000;          // и сюда задача уже не дойдёт
  }, doc).timeout(20);
} catch (e) {
  print(String(e));
}
print(JSON.stringify(doc));

const stats = new RwLock({ inFlight: 0, served: 0 });
const job = spawn(async (stats) => {
  using g = await stats.write();
  g.value.inFlight++;
  await sleep(1000);
  g.value.inFlight--;
  g.value.served++;
}, stats).timeout(20);
try {
  await job;
} catch (e) {
  print(String(e));
}
print('poisoned:', stats.poisoned);
try {
  await stats.read();
} catch (e) {
  print(String(e));
}
stats.clearPoison();           // данные проверены
using g = await stats.read();
print(JSON.stringify(g.value));

// Уборка под spawn.shield(): отмена её не прерывает, и счётчик сходится.
const fair = new RwLock({ inFlight: 0, served: 0 });
const work = spawn(async (fair) => {
  {
    using g = await fair.write();
    g.value.inFlight++;
  }
  try {
    await sleep(1000);
    using g = await fair.write();
    g.value.served++;
  } finally {
    await spawn.shield(async () => {
      using g = await fair.write();
      g.value.inFlight--;
    });
  }
}, fair).timeout(20);
try {
  await work;
} catch (e) {
  print(String(e));
}
using f = await fair.read();
print('poisoned:', fair.poisoned, JSON.stringify(f.value));

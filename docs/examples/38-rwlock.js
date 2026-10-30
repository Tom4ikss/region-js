// d8-flags: --module
// Счётчик, который пишут четыре задачи и читают все сразу.
const stats = new RwLock({ hits: 0, writers: [] });

await Promise.all([1, 2, 3, 4].map((worker) => spawn(async (stats, worker) => {
  for (let i = 0; i < 100; i++) {
    using g = await stats.write();   // один писатель за раз
    g.value.hits++;
    if (!g.value.writers.includes(worker)) g.value.writers.push(worker);
  }
}, stats, worker)));

let kept;
{
  using r = await stats.read();      // читателей может быть много
  print('всего:', r.value.hits, '| писали задачи', r.value.writers.toSorted().join(', '));
  kept = r.value;
  try {
    r.value.hits = 0;
  } catch (e) {
    print('запись под read():', e.message);
  }
}
// Лок отпущен: сохранённая ссылка больше не работает.
try {
  print(kept.hits);
} catch (e) {
  print('после отпуска:', e.message);
}

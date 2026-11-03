// d8-flags: --module
// Задача берёт билет на замороженный регион в момент spawn(), а не при старте.
// region.thawWhenFree() ждёт, пока билеты сдадут, и размораживает.
const config = new Region().run(() => ({ limit: 10 }));
const region = Region.of(config);
region.freeze();

spawn.poolSize = 1;
const busy = spawn(() => {
  const end = performance.now() + 50;
  while (performance.now() < end);
});
const queued = spawn((config) => config.limit, config);  // ждёт в очереди

print('readers сразу после spawn:', region.readers);
try {
  region.thaw();
} catch (e) {
  print(e.name + ':', e.message);
}

await region.thawWhenFree();         // задачи закончились, билеты сданы
config.limit = 99;
print('задача прочитала', await queued, '| теперь limit =', config.limit);
await busy;

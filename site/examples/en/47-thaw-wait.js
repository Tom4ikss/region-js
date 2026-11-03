// d8-flags: --module
// A task takes its borrow on a frozen region at the spawn() call, not when it starts.
// region.thawWhenFree() waits until the borrows are returned, then thaws.
const config = new Region().run(() => ({ limit: 10 }));
const region = Region.of(config);
region.freeze();

spawn.poolSize = 1;
const busy = spawn(() => {
  const end = performance.now() + 50;
  while (performance.now() < end);
});
const queued = spawn((config) => config.limit, config);  // waits in the queue

print('readers right after spawn:', region.readers);
try {
  region.thaw();
} catch (e) {
  print(e.name + ':', e.message);
}

await region.thawWhenFree();         // the tasks finished, the borrows are returned
config.limit = 99;
print('the task read', await queued, '| now limit =', config.limit);
await busy;

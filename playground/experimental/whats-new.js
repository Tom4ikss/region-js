// What is new in 0.4: #{} and #[] come with --harmony-regions, objects are
// written straight into a region, and spawn.shield() takes a timeout.
// Run with Cmd+Shift+B. Every section stands on its own: change anything.
const section = (title) => print(`\n== ${title}`);

// 1. Literals need no flag of their own any more. Inside region.enter(),
// #{} and #[] create objects right in the region, without a copy.
section('literals');
/** @typedef {{ id: number, price: number, tags: string[] }} Order */
const region = new Region();
let shop;
{
  using _ = region.enter();
  shop = #{ orders: /** @type {Order[]} */ (#[]), total: 0 };
  for (let id = 1; id <= 3; id++) {
    shop.orders.push(#{ id, price: id * 10, tags: #['new'] });
    shop.total += id * 10;
  }
}
print(JSON.stringify(shop));

// A plain object does not go into a region: create it there instead.
try {
  shop.orders.push({ id: 4, price: 40, tags: [] });
} catch (e) {
  print(String(e));
}

// 2. 'use region': every {} and [] of the function is #{} and #[], in syntax
// that every tool already understands.
section("'use region'");
/** @returns {Order} */
function makeOrder(id) {
  'use region';
  return { id, price: id * 10, tags: ['use region'] };
}
{
  using _ = region.enter();
  shop.orders.push(makeOrder(4));
}
print(JSON.stringify(shop.orders[3]));

// 3. A task has no current region: enter the one that came with it.
// region.run() copies in one object built by ordinary code.
section('in a task');
const count = await spawn((shop) => {
  const r = Region.of(shop);
  {
    using _ = r.enter();
    shop.orders.push(#{ id: 5, price: 50, tags: #['from a task'] });
  }
  shop.orders.push(r.run(() => ({ id: 6, price: 60, tags: ['via run'] })));
  return shop.orders.length;
}, shop);
print('orders after the task:', count, JSON.stringify(shop.orders[count - 1]));

// 4. spawn.shield(fn, { timeout }): cleanup that the abort does not
// interrupt, but with a deadline, so cleanup that hangs cannot keep the task
// forever. Try a larger timeout, or let the cleanup finish.
section('spawn.shield with a timeout');
const started = new Channel(1);
const log = new Region().run(() => /** @type {string[]} */ ([]));
const task = spawn(async (started, log) => {
  await started.send('started');
  try {
    await new Promise(() => {}); // waits until the abort
  } finally {
    try {
      await spawn.shield(async () => {
        log.push(`cleanup runs, aborted: ${spawn.aborted()}`);
        await new Promise(() => {}); // cleanup that hangs
      }, { timeout: 50 });
    } catch (e) {
      log.push(`shield: ${e}`);
    }
  }
}, started, log);
await started.recv();
const start = performance.now();
task.abort();
let outcome;
try {
  await task;
  outcome = 'finished';
} catch (e) {
  outcome = /** @type {Error} */ (e).name;
}
print(`task: ${outcome} after ${Math.round(performance.now() - start)} ms`);
print(log.join('\n'));

// 5. A shield that runs out of time while it writes under a lock poisons it,
// as an aborted task does.
section('timed-out shield and RwLock');
const lock = new RwLock({ n: 0 });
const shieldError = await spawn(async (lock) => {
  try {
    await spawn.shield(async () => {
      using g = await lock.write();
      g.value.n = 1;
      await new Promise(() => {});
    }, { timeout: 30 });
  } catch (e) {
    return /** @type {Error} */ (e).name;
  }
}, lock);
print('shield:', shieldError, '| lock poisoned:', lock.poisoned);

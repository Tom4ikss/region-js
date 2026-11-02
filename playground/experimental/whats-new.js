// A tour of the newer APIs: #{} and #[] come with --harmony-regions, objects
// are written straight into a region, spawn.scope() keeps tasks inside a
// block, and spawn.shield() protects cleanup from the abort, with a timeout.
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

// 4. spawn.scope(): tasks started with s.spawn() cannot outlive the block.
// It ends only after all of them; the first error aborts the others and is
// what the scope fails with.
section('spawn.scope');
const sum = await spawn.scope(async (s) => {
  const squares = [1, 2, 3, 4].map((n) => s.spawn((n) => n * n, n));
  let total = 0;
  for (const square of squares) total += await square;
  return total;
});
print('sum of squares:', sum);
try {
  await spawn.scope(async (s) => {
    const never = s.channel();
    s.spawn(async (never) => { await never.recv(); }, never); // would wait forever
    s.spawn(() => { throw new RangeError('one task failed'); });
  });
} catch (e) {
  print(`scope: ${e} (the waiting task was aborted)`);
}

// 5. spawn.shield(fn): cleanup that the abort does not interrupt. Inside fn
// awaits do not throw and spawn.aborted() is false. Once fn is done,
// awaiting the shield throws the abort again: the task still fails.
section('spawn.shield');
const working = new Channel(1);
const never = new Channel(1);
const steps = new Region().run(() => /** @type {string[]} */ ([]));
const cleaned = spawn(async (working, never, steps) => {
  try {
    await working.send('working');
    await never.recv(); // waits until the abort
  } catch (e) {
    steps.push(`work: ${/** @type {Error} */ (e).name}`);
  } finally {
    try {
      await spawn.shield(async () => {
        await null; // would throw AbortError outside the shield
        steps.push(`cleanup, aborted inside the shield: ${spawn.aborted()}`);
      });
    } catch (e) {
      steps.push(`after the shield: ${/** @type {Error} */ (e).name}`);
    }
  }
}, working, never, steps);
await working.recv();
cleaned.abort();
let cleanedOutcome;
try {
  await cleaned;
  cleanedOutcome = 'finished';
} catch (e) {
  cleanedOutcome = /** @type {Error} */ (e).name;
}
print(steps.join('\n'));
print('task:', cleanedOutcome);

// 6. spawn.shield(fn, { timeout }): cleanup that the abort does not
// interrupt, but with a deadline, so cleanup that hangs cannot keep the task
// forever. Try a larger timeout, or let the cleanup finish.
section('spawn.shield with a timeout');
const started = new Channel(1);
const log = new Region().run(() => /** @type {string[]} */ ([]));
const task = spawn(async (started, never, log) => {
  await started.send('started');
  try {
    await never.recv(); // waits until the abort
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
}, started, never, log);
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

// 7. A shield that runs out of time while it writes under a lock poisons it,
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

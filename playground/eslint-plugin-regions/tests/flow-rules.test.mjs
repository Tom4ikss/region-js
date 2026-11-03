// node eslint-plugin-regions/tests/flow-rules.test.mjs
// Rules that follow the code through await: traps 4, 6, 11, 12 and 19 of
// research/async-traps.md.
import { RuleTester } from 'eslint';
import awaitHoldingGuard from '../rules/no-await-holding-guard.mjs';
import guardValueEscape from '../rules/no-guard-value-escape.mjs';
import staleRegionCheck from '../rules/no-stale-region-check.mjs';
import useAfterSend from '../rules/no-use-after-send.mjs';
import writeToSpawnCopy from '../rules/no-write-to-spawn-copy.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });

tester.run('no-await-holding-guard', awaitHoldingGuard, {
  valid: [
    // The guard's block ends before the await.
    `async function f(state) {
       { using g = await state.write(); g.value.n++; }
       await sleep(5);
     }`,
    // Released by hand first.
    `async function f(state) {
       const g = await state.write();
       g.value.n++;
       g.release();
       await sleep(5);
     }`,
    // The await is in a callback that runs later, not under the guard.
    `async function f(state) {
       using g = await state.write();
       setTimeout(async () => { await sleep(5); }, 0);
     }`,
    // Taking the guard itself is the only await.
    `async function f(state) { using g = await state.read(); return g.value.n; }`,
    // A const guard that is never released: its life is not followed.
    `async function f(state) { const g = await state.write(); await sleep(5); }`,
    // Not a guard.
    `async function f(file) { using h = open(file); await h.flush(); }`,
  ],
  invalid: [
    // Trap 11: work under the write lock.
    {
      code: `async function handle(req, state) {
        using g = await state.write();
        g.value.inFlight++;
        await sleep(req.cost);
        g.value.served++;
      }`,
      errors: [{ messageId: 'lockHeld', data: { name: 'g' }, line: 4 }],
    },
    // A read lock across await, only the first await is reported.
    {
      code: `spawn(async (lock) => {
        using r = await lock.read();
        await sleep(30);
        await sleep(30);
        return r.value.version;
      }, lock);`,
      errors: [{ messageId: 'lockHeld', line: 3 }],
    },
    // Before release() by hand.
    {
      code: `async function f(state) {
        const g = state.tryWrite();
        await sleep(5);
        g.release();
      }`,
      errors: [{ messageId: 'lockHeld', line: 3 }],
    },
    // A borrow held across await (cache.js, borrow-await).
    {
      code: `const handler = async () => {
        using b = region.borrow();
        const p = cache.prices.sku1;
        await sleep(200);
        return p;
      };`,
      errors: [{ messageId: 'borrowHeld', data: { name: 'b' }, line: 4 }],
    },
    // for await is an await too.
    {
      code: `async function f(state, ch) {
        using g = state.writeSync();
        for await (const v of ch) g.value.sum += v;
      }`,
      errors: [{ messageId: 'lockHeld', line: 3 }],
    },
  ],
});

tester.run('no-guard-value-escape', guardValueEscape, {
  valid: [
    // Used under the guard only.
    `async function f(lock) {
       using r = await lock.read();
       const prices = r.value.prices;
       return prices.sku1;
     }`,
    // A number is copied out: no member access after the guard.
    `async function f(lock) {
       let version;
       { using r = await lock.read(); version = r.value.version; }
       await sleep(5);
       return version + 1;
     }`,
    // A method call makes a new value.
    `async function f(lock) {
       let list;
       { using r = await lock.read(); list = r.value.items.slice(); }
       return list.length;
     }`,
    // Reassigned before the use.
    `async function f(lock) {
       let prices;
       { using r = await lock.read(); prices = r.value.prices; }
       prices = { sku1: 0 };
       return prices.sku1;
     }`,
    // A primitive under the guard is returned.
    `async function f(lock) { using r = await lock.read(); return r.value.version; }`,
  ],
  invalid: [
    // Trap 12 (cache.js, rwlock).
    {
      code: `spawn(async (lock, i) => {
        let prices;
        {
          using r = await lock.read();
          prices = r.value.prices;
        }
        await sleep(5);
        return prices['sku' + i];
      }, lock, i);`,
      errors: [{ messageId: 'escaped', data: { name: 'prices', guard: 'r', line: 5 }, line: 8 }],
    },
    // After release() by hand.
    {
      code: `async function f(lock) {
        const g = await lock.write();
        const items = g.value.items;
        g.release();
        for (const item of items) print(item);
      }`,
      errors: [{ messageId: 'escaped', line: 5 }],
    },
    // The locked object itself is returned.
    {
      code: `async function f(lock) { using r = await lock.read(); return r.value; }`,
      errors: [{ messageId: 'returned', data: { guard: 'r' } }],
    },
  ],
});

tester.run('no-write-to-spawn-copy', writeToSpawnCopy, {
  valid: [
    // A region object is moved, not copied.
    `const stats = new Region().run(() => ({ batches: 0 }));
     await spawn((stats) => { stats.batches++; }, stats);`,
    // Only read.
    `const config = { limit: 10 };
     await spawn((config) => config.limit * 2, config);`,
    // The copy is given back.
    `const report = { done: [] };
     const result = await spawn((report) => { report.done.push(1); return report; }, report);`,
    `const list = [];
     await spawn(() => { list.push(1); return list; });`,
    // A 'use region' function makes region objects.
    `function main() {
       'use region';
       const stats = { batches: 0 };
       return spawn((stats) => { stats.batches++; }, stats);
     }`,
    // Unknown origin: a parameter of the caller.
    `async function f(stats) { await spawn((stats) => { stats.n++; }, stats); }`,
    // A local object of the task.
    `await spawn(() => { const local = { n: 0 }; local.n++; return local.n; });`,
    // A variable of the task itself.
    `await spawn(() => { let n = 0; n++; return n; });`,
  ],
  invalid: [
    // Trap 4.
    {
      code: `const stats = { batches: 0 };
        await Promise.all(workers.map(() => spawn((stats) => { stats.batches++; }, stats)));
        print(stats.batches);`,
      errors: [{ messageId: 'copy', data: { name: 'stats' }, line: 2 }],
    },
    // fanout.js, plain-back.
    {
      code: `const report = { done: [], errors: 0 };
        await Promise.all([0, 1, 2].map((i) => spawn((report, i) => { report.done.push(i); }, report, i)));`,
      errors: [{ messageId: 'copy', data: { name: 'report' } }],
    },
    // Captured instead of passed.
    {
      code: `const seen = [];
        await spawn(() => { seen.push(1); });`,
      errors: [{ messageId: 'copy', data: { name: 'seen' } }],
    },
    // A captured variable is assigned (site/examples/en/18-spawn-gotchas.js).
    {
      code: `let counter = 0;
        spawn(() => ++counter).join();
        await spawn(() => { counter = 5; });`,
      errors: [
        { messageId: 'assign', data: { name: 'counter' }, line: 2 },
        { messageId: 'assign', data: { name: 'counter' }, line: 3 },
      ],
    },
    {
      code: `const totals = {};
        await spawn((t) => { Object.assign(t, { a: 1 }); delete t.b; }, totals);`,
      errors: [{ messageId: 'copy' }, { messageId: 'copy' }],
    },
  ],
});

tester.run('no-stale-region-check', staleRegionCheck, {
  valid: [
    // Checked again after the await.
    `async function f(region, cfg) {
       if (region.frozen) {
         await sleep(20);
         if (region.frozen) { using b = region.borrow(); return 1; }
       }
     }`,
    // The await is before the check.
    `async function f(region) {
       await sleep(20);
       if (region.frozen) { using b = region.borrow(); }
     }`,
    // Nothing of the region is used after the await.
    `async function f(region) {
       if (region.frozen) { print('frozen'); await sleep(20); print('done'); }
     }`,
    // The await is in a callback.
    `function f(region) {
       if (region.frozen) setTimeout(async () => { await sleep(1); region.thaw(); });
     }`,
  ],
  invalid: [
    // Trap 19 (server.js, check-then-use).
    {
      code: `const region = new Region();
        const cfg = region.run(() => ({ limit: 10 }));
        const reader = async () => {
          if (region.frozen) {
            await sleep(20);
            using b = region.borrow();
            return cfg.limit;
          }
        };`,
      errors: [{ messageId: 'stale', data: { check: 'region.frozen', line: 4 }, line: 5 }],
    },
    // Only an object of the region is used after the await.
    {
      code: `const region = new Region();
        const cfg = region.run(() => ({ limit: 10 }));
        async function f() {
          if (!region.frozen) { await sleep(1); cfg.limit = 5; }
        }`,
      errors: [{ messageId: 'stale', data: { check: 'region.frozen', line: 4 } }],
    },
    // Region.of() and a lock.
    {
      code: `async function f(doc, lock) {
          if (Region.of(doc).readers === 0) { await save(); Region.of(doc).thaw(); }
          if (!lock.poisoned) { await sleep(1); using g = await lock.write(); }
        }`,
      errors: [
        { messageId: 'stale', data: { check: 'Region.of(doc).readers', line: 2 } },
        { messageId: 'stale', data: { check: 'lock.poisoned', line: 3 } },
      ],
    },
  ],
});

tester.run('no-use-after-send', useAfterSend, {
  valid: [
    // Used before the send.
    `const batch = region.run(() => ({ rows: [] }));
     batch.rows.length;
     await out.send(batch);`,
    // Plain data is copied.
    `const batch = { rows: [] };
     await out.send(batch);
     batch.rows.push(1);`,
    // A frozen region is shared.
    `const region = new Region();
     const config = region.run(() => ({ name: 'prod' }));
     region.freeze();
     await out.send(config);
     config.name;`,
    // A new value is received first.
    `let batch = region.run(() => ({ n: 0 }));
     await out.send(batch);
     batch = (await back.recv()).value;
     batch.n;`,
    // The other branch.
    `const batch = region.run(() => ({ n: 0 }));
     if (ready) await out.send(batch); else batch.n++;`,
    // Code that runs later.
    `const batch = region.run(() => ({ n: 0 }));
     out.sendSync(batch);
     export const later = () => batch.n;`,
  ],
  invalid: [
    // Trap 6 (pipeline.js, use-after-send).
    {
      code: `const batch = new Region().run(() => ({ rows: [], total: 0 }));
        await out.send(batch);
        print('sent', batch.rows.length);`,
      errors: [{ messageId: 'usedAfterSend', data: { name: 'batch', line: 2 }, line: 3 }],
    },
    {
      code: `const region = new Region();
        const doc = region.run(() => ({ words: 0 }));
        region.freeze();
        region.thaw();
        ch.sendSync(doc);
        doc.words++;`,
      errors: [{ messageId: 'usedAfterSend', line: 6 }],
    },
  ],
});

console.log('all flow rule tests passed');

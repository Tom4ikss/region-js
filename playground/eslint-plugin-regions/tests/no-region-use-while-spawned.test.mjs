// node eslint-plugin-regions/tests/no-region-use-while-spawned.test.mjs
import { RuleTester } from 'eslint';
import floatingBorrowRule from '../rules/no-floating-borrow-while.mjs';
import floatingRule from '../rules/no-floating-spawn.mjs';
import rule from '../rules/no-region-use-while-spawned.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
const error = (name) => ({ messageId: 'usedWhileSpawned', data: { name, line: 2 } });

tester.run('no-region-use-while-spawned', rule, {
  valid: [
    // Awaited or joined right away.
    `const state = new Region().run(() => ({ n: 0 }));
     await spawn(() => state.n++);
     state.n;`,
    `const state = new Region().run(() => ({ n: 0 }));
     spawn(() => state.n++).join();
     state.n;`,
    // The handle is awaited before the use.
    `const state = new Region().run(() => ({ n: 0 }));
     const task = spawn(() => state.n++);
     await task;
     state.n;`,
    // Awaited together with other tasks.
    `const state = new Region().run(() => ({ n: 0 }));
     await Promise.all([spawn(() => state.n++)]);
     state.n;`,
    // Plain data is copied into the task, so main keeps its own.
    `const words = ['a', 'b'];
     const task = spawn(() => words.length);
     words.push('c');
     await task;`,
    // A frozen region is shared, not moved.
    `const region = new Region();
     const config = region.run(() => ({ name: 'prod' }));
     region.freeze();
     const task = spawn(() => config.name);
     config.name;
     await task;`,
    // Code in a callback that runs later is not reported.
    `const state = new Region().run(() => ({ n: 0 }));
     const task = spawn(() => state.n++);
     setTimeout(() => state.n, 100);
     await task;`,
    // Awaited on every iteration: each task gets the region in turn.
    `const state = new Region().run(() => ({ n: 0 }));
     for (const i of [0, 1, 2]) await spawn(() => state.n++);`,
    // Frozen region shared by tasks started in a loop.
    `const region = new Region();
     const config = region.run(() => ({ name: 'prod' }));
     region.freeze();
     await Promise.all([0, 1].map(() => spawn(() => config.name)));`,
  ],
  invalid: [
    {
      // Tasks may read a frozen region but not write it.
      code: `const region = new Region();
     const state = region.run(() => ({ n: 0 }));
     region.freeze();
     await Promise.all([0, 1].map(() => spawn(() => { state.n++; return state.n; })));`,
      errors: [{ messageId: 'writeToFrozen', data: { name: 'state' } }],
    },
    {
      code: `const state = new Region().run(() => ({ n: 0, list: [] }));
     Region.of(state).freeze();
     await spawn(() => { state.list[0] = 1; });`,
      errors: [{ messageId: 'writeToFrozen', data: { name: 'state' } }],
    },
    {
      // Every iteration wants the same region.
      code: `const state = new Region().run(() => ({ n: 0 }));
     await Promise.all([0, 1, 2, 3].map(() => spawn(() => state.n++)));`,
      errors: [{ messageId: 'spawnedInLoop', data: { name: 'state' } }],
    },
    {
      code: `const state = new Region().run(() => ({ n: 0 }));
     for (let i = 0; i < 3; i++) spawn(() => state.n++);`,
      errors: [{ messageId: 'spawnedInLoop', data: { name: 'state' } }],
    },
    {
      code: `const state = new Region().run(() => ({ n: 0 }));
     const task = spawn(() => state.n++);
     print(state.n);
     await task;`,
      errors: [error('state')],
    },
    {
      // Nobody waits for the task.
      code: `const state = new Region().run(() => ({ n: 0 }));
     spawn(() => state.n++);
     state.n = 5;`,
      errors: [error('state')],
    },
    {
      // Passed as an argument instead of captured.
      code: `const state = new Region().run(() => ({ n: 0 }));
     const task = spawn((s) => s.n++, state);
     state.n;
     await task;`,
      errors: [error('state')],
    },
    {
      // A second task wants the same region while the first one has it.
      code: `const state = new Region().run(() => ({ n: 0 }));
     const first = spawn(() => state.n++);
     const second = spawn(() => state.n++);
     await Promise.all([first, second]);`,
      errors: [error('state')],
    },
    {
      // Frozen, but thawed again before the task.
      code: `const region = new Region();
     const config = region.run(() => ({ name: 'prod' }));
     region.freeze();
     region.thaw();
     const task = spawn(() => config.name);
     config.name;
     await task;`,
      errors: [{ messageId: 'usedWhileSpawned', data: { name: 'config', line: 5 } }],
    },
  ],
});

// With checkAllCaptures every captured variable counts.
tester.run('no-region-use-while-spawned (checkAllCaptures)', rule, {
  valid: [],
  invalid: [
    {
      code: `const words = ['a'];
     const task = spawn(() => words.length);
     words.length;
     await task;`,
      options: [{ checkAllCaptures: true }],
      errors: [error('words')],
    },
  ],
});

tester.run('no-floating-spawn', floatingRule, {
  valid: [
    'await spawn(() => 1);',
    'spawn(() => 1).join();',
    'const task = spawn(() => 1);',
    'await Promise.all([0, 1].map((i) => spawn(() => i)));',
  ],
  invalid: [
    { code: 'spawn(() => 1);', errors: [{ messageId: 'floating' }] },
    {
      code: '[0, 1].map((i) => { spawn(() => i); return i; });',
      errors: [{ messageId: 'returnsOther', data: { value: 'i' } }],
    },
    {
      code: '[0, 1].forEach((i) => { spawn(() => i); });',
      errors: [{ messageId: 'floating' }],
    },
  ],
});

tester.run('no-floating-borrow-while', floatingBorrowRule, {
  valid: [
    'await Region.of(state).borrowWhile(async () => state.n);',
    'spawn(() => Region.of(state).borrowWhile(async () => state.n));',
    'spawn(() => { return Region.of(state).borrowWhile(async () => state.n); });',
    // A synchronous callback is done when borrowWhile() returns.
    'Region.of(state).borrowWhile(() => print(state.n));',
  ],
  invalid: [
    {
      code: `spawn(() => {
        Region.of(state).borrowWhile(async () => { await sleep(); print(state.n); });
      });`,
      errors: [{ messageId: 'floating' }],
    },
    {
      code: 'region.borrowWhile(async function () { await sleep(); });',
      errors: [{ messageId: 'floating' }],
    },
  ],
});

console.log('all rule tests passed');

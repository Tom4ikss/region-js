// node --harmony-regions spawn-basic.js
// spawn() in Node.js: tasks run in worker_threads workers of the pool, their
// arguments and results travel in regions, channels work between the tasks
// and the main thread, and AsyncLocalStorage keeps working inside a task:
// the task shares the continuation data with Node's AsyncContextFrame.
'use strict';
const assert = require('node:assert');
const { AsyncLocalStorage } = require('node:async_hooks');

async function main() {
  assert.strictEqual(await spawn((a, b) => a + b, 2, 3), 5);

  const doubled = await Promise.all(
    Array.from({ length: 200 }, (_, i) => spawn((x) => x * 2, i)));
  assert.deepStrictEqual(doubled, Array.from({ length: 200 }, (_, i) => i * 2));

  // A result in a region comes back without a copy.
  const rows = await spawn((n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ id: i, name: 'row ' + i });
    return out;
  }, 1000);
  assert.strictEqual(rows.length, 1000);
  assert.strictEqual(rows[999].name, 'row 999');

  // A channel between a task and this thread.
  const channel = new Channel();
  const task = spawn(async (c) => {
    for (let i = 0; i < 10; i++) await c.send(i);
    c.close();
    return 'sent';
  }, channel);
  const got = [];
  for await (const value of channel) got.push(value);
  assert.deepStrictEqual(got, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual(await task, 'sent');

  // AsyncLocalStorage inside a task, across awaits.
  const store = await spawn(async () => {
    const { AsyncLocalStorage } = process.getBuiltinModule('node:async_hooks');
    const als = new AsyncLocalStorage();
    return als.run(7, async () => {
      await null;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return als.getStore();
    });
  });
  assert.strictEqual(store, 7);

  // And on this thread around a spawn().
  const als = new AsyncLocalStorage();
  await als.run('outer', async () => {
    assert.strictEqual(await spawn(() => 1), 1);
    assert.strictEqual(als.getStore(), 'outer');
  });

  // A failing task rejects with its error.
  // A task handle is a thenable, not a promise.
  await assert.rejects(async () => {
    await spawn(() => { throw new RangeError('nope'); });
  }, { name: 'RangeError', message: 'nope' });

  console.log('ok');
}

main();

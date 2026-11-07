// node --harmony-regions region-await.js
// region.run(async fn) in Node.js: the region stays current after awaits,
// also of Node's own promises (timers, fs), and AsyncLocalStorage keeps its
// store next to it: both live in the continuation data.
'use strict';
const assert = require('node:assert');
const { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: sleep } = require('node:timers/promises');
const fs = require('node:fs/promises');

function make(n) {
  'use region';
  return { n, list: [n] };
}

async function main() {
  const als = new AsyncLocalStorage();
  const region = new Region();
  const out = await als.run({ request: 7 }, () => region.run(async () => {
    const first = make(1);
    await sleep(1);
    const second = make(2);
    await fs.readFile(__filename);
    const third = make(3);
    return { first, second, third, store: als.getStore().request };
  }));
  assert.strictEqual(Region.of(out), region);
  assert.strictEqual(Region.of(out.first), region);
  assert.strictEqual(Region.of(out.second), region);
  assert.strictEqual(Region.of(out.third), region);
  assert.strictEqual(out.store, 7);
  assert(!Region.isRegionObject(make(4)));

  // Requests in flight at once, each in its own region.
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => {
    const r = new Region();
    return als.run({ i }, () => r.run(async () => {
      await sleep(i % 5);
      const row = make(i);
      await null;
      return { row, same: Region.of(row) === r, store: als.getStore().i };
    }));
  }));
  results.forEach((result, i) => {
    assert(result.same);
    assert.strictEqual(result.store, i);
    assert.strictEqual(result.row.n, i);
  });
  assert(!Region.isRegionObject(make(5)));
  console.log('ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

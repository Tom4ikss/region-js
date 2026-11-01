// d8 --harmony-region-literals --allow-natives-syntax --expose-gc --verify-heap region-gc.js
// d8 --harmony-region-literals --allow-natives-syntax --expose-gc region-gc.js -- pool
// The owner of a region collects it by itself, without stopping other
// threads, once nothing points into it: no other isolate holds it (see
// region-holders.js) and the owner's own GC finds no pointer to it. Its pages
// go to a pool that new regions take pages from. The owner looks at its full
// GCs, and at a young generation GC that it starts after taking
// --region-gc-pages pages worth of region memory (64, 16 MB). %RegionCollectedCount and
// %RegionReusedPageCount count for the whole process. With --verify-heap
// the pages do not go to the pool: they get a pattern that fails heap
// verification if anything still points into them. While the shared heap is
// being marked owners collect nothing, so the checks fail under
// --stress-incremental-marking; under --stress-compaction every GC of the
// main thread is a shared one, which collects the shared heap instead.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
// Without --verify-heap, pass `-- pool` to check that pages are reused.
const pool = (globalThis.arguments ?? []).includes('pool');

const worker = new Worker(`
  function orders(region, count) {
    'use region';
    using _ = region.enter();
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({ id: i, customer: { name: 'c' + (i % 10) }, items: [{ qty: 1 }, { qty: 2 }] });
    }
    return list;
  }
  const sum = (list) => list.reduce((s, o) => s + o.id + o.items[1].qty, 0);
  onmessage = ({ data }) => {
    if (data.op === 'churn') {
      // Regions on pages of their own, and small ones on chunks, all dropped.
      const kept = orders(new Region(), 3000);
      const before = %RegionCollectedCount();
      for (let round = 0; round < data.rounds; round++) {
        orders(new Region(), data.count);
        if (round % 10 === 9) gc();
      }
      gc();
      postMessage([%RegionCollectedCount() - before, sum(kept)]);
    } else if (data.op === 'keep') {
      // A region with a pointer to it stays, however many GCs come.
      const region = new Region();
      const list = orders(region, 5000);
      for (let i = 0; i < 5; i++) gc();
      postMessage(sum(list));
    } else if (data.op === 'freeze') {
      const region = new Region();
      const list = orders(region, 3000);
      region.freeze();
      postMessage({ list }, []);
    } else if (data.op === 'give') {
      const region = new Region();
      const list = orders(region, 3000);
      postMessage({ list }, [region]);
      gc();
      gc();
    } else if (data.op === 'collect') {
      gc();
      gc();
      postMessage(%RegionCollectedCount());
    }
  };`, { type: 'string' });

// While the shared heap is being marked, owners collect nothing: the marking
// sees their objects. The main thread drives that marking and waits here, so
// it finishes it after each step.
const step = (message) => {
  worker.postMessage(message);
  const result = worker.getMessage();
  gc();
  return result;
};

let [collected, keptSum] = step({ op: 'churn', rounds: 60, count: 3000 });
check('dropped regions collected by their owner', collected >= 50);
check('a live region next to them intact', keptSum === 3000 * 2999 / 2 + 3000 * 2);

[collected] = step({ op: 'churn', rounds: 200, count: 20 });
check('small regions on chunks collected', collected >= 150);

check('a held region stays', step({ op: 'keep' }) === 5000 * 4999 / 2 + 5000 * 2);

// A frozen region is read by others: its owner never collects it alone.
const frozen = step({ op: 'freeze' }).list;
{
  using _ = Region.of(frozen).borrow();
  step({ op: 'collect' });
  check('frozen region intact', frozen.length === 3000 && frozen[2999].items[1].qty === 2);
}

// A region given away: the old owner is not the owner any more, and the new
// one holds it.
const given = step({ op: 'give' }).list;
step({ op: 'collect' });
check('given region intact', given.length === 3000 && given[2999].customer.name === 'c9');

// The main thread looks for regions to collect after taking 16 MB of region
// memory, in a young generation GC: no gc() call needed.
function build(region, count) {
  'use region';
  using _ = region.enter();
  const list = [];
  for (let i = 0; i < count; i++) list.push({ id: i, tags: ['a', 'b'] });
  return list;
}
const before = %RegionCollectedCount();
const reusedBefore = %RegionReusedPageCount();
const live = build(new Region(), 1000);
for (let round = 0; round < 400; round++) build(new Region(), 5000);
check('main thread collects without gc()', %RegionCollectedCount() - before >= 100);
if (pool) check('pages reused', %RegionReusedPageCount() - reusedBefore >= 100);
check('live region of main intact', live[999].id === 999 && live[999].tags[1] === 'b');

worker.terminate();
print('done');

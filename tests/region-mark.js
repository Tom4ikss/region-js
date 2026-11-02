// d8 --harmony-regions --allow-natives-syntax --expose-gc --verify-heap --region-gc-pages=8 region-mark.js
// d8 --harmony-regions --allow-natives-syntax --expose-gc --region-gc-pages=8 region-mark.js -- reuse
// The owner of a live region that no other isolate holds marks it from its
// own pointers and sweeps it, without stopping other threads: dead objects
// on the pages of the region become its free memory, empty pages go to the
// pool. It does so in the young generation GC that it starts after taking
// --region-gc-pages pages worth of region memory, new or reused, once the
// region allocated as much as was
// alive at its last marking, and at least 1 MB. %RegionMarkedCount counts
// markings for the whole process, %RegionPageCount the pages of a region.
// With --verify-heap dead memory is not reused: it gets a pattern that fails
// heap verification if anything still points into it, so pass `-- reuse`
// without it to check that the region stays small. While the shared heap is
// being marked owners mark nothing, so the checks fail under
// --stress-incremental-marking; under --stress-compaction every GC of the
// main thread is a shared one.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const reuse = (globalThis.arguments ?? []).includes('reuse');

// A table whose rows are replaced again and again: the old rows are garbage
// inside a region that stays alive. The first rows, the deep object and the
// rows of the first rounds sit on chunks of common pages.
const source = `
  function create(region, count) {
    'use region';
    using _ = region.enter();
    const deep = { a: { b: { c: [1, 2, { d: 'deep' }] } } };
    const rows = [];
    for (let i = 0; i < count; i++) rows.push({ id: i, round: 0, items: [{ qty: i }] });
    return { deep, rows, log: [] };
  }
  function churn(region, table, round) {
    'use region';
    using _ = region.enter();
    const rows = table.rows;
    for (let i = 0; i < rows.length; i++) {
      rows[i] = { id: i, round, items: [{ qty: i + round }, { qty: 1 }] };
    }
    // An array that grows leaves its old values behind.
    table.log.push({ round });
    if (table.log.length > 50) table.log = [];
  }
  function sum(table) {
    let s = 0;
    for (const row of table.rows) s += row.id + row.items[0].qty + row.items[1].qty;
    return s;
  }
  function intact(table, round) {
    return table.deep.a.b.c[2].d === 'deep' &&
        table.rows.every((row, i) => row.id === i && row.round === round) &&
        table.log[table.log.length - 1].round === round;
  }
  function run(count, rounds) {
    const region = new Region();
    const table = create(region, count);
    const marked = %RegionMarkedCount();
    for (let round = 1; round <= rounds; round++) churn(region, table, round);
    return [%RegionMarkedCount() - marked, %RegionPageCount(region.id),
            sum(table), intact(table, rounds)];
  }
`;
const count = 2000;
const rounds = 150;
const expected = count * (count - 1) + rounds * count + count;

const worker = new Worker(source + `
  onmessage = ({ data }) => postMessage(run(data.count, data.rounds));
`, { type: 'string' });
// The main thread drives the marking of the shared heap and waits here, so
// it finishes it after each step.
worker.postMessage({ count, rounds });
let [marked, pages, total, ok] = worker.getMessage();
gc();
print('worker: markings', marked, 'pages', pages);
check('the worker marks its live region', marked >= 3);
check('the region of the worker intact', ok && total === expected);
// About 60 MB of rows die, about 1 MB is alive.
if (reuse) check('the region of the worker stays small', pages <= 20);
worker.terminate();

// The main thread marks too, though every GC of it stops the others.
eval(source);
[marked, pages, total, ok] = run(count, rounds);
print('main: markings', marked, 'pages', pages);
check('the main thread marks its live region', marked >= 3);
check('the region of the main thread intact', ok && total === expected);
if (reuse) check('the region of the main thread stays small', pages <= 20);
print('done');

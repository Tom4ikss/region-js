// d8 --harmony-regions --allow-natives-syntax --expose-gc --verify-heap sealed-gc.js
// d8 --harmony-regions --allow-natives-syntax --expose-gc --stress-compaction sealed-gc.js
// The marker of the shared heap does not visit a sealed region on pages of
// its own: while anything points into the region, its pages count as live,
// and what it points to elsewhere (shapes, keys, its first objects, which
// are on common pages) is marked at the end of each marking. Its contents
// stay intact through GCs that compact the shared heap, and the GC releases
// it once nothing refers to it, be it a pointer to its pages or to its first
// objects, from this isolate or from another.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};

const ROWS = 20000;
// Rows of a few shapes, with strings, numbers and nested arrays.
const build = () => {
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    const row = { id: i, name: 'item ' + i, price: i + 0.25, tags: ['a', 'b' + (i % 7)] };
    if (i % 3 === 0) row.stock = i % 50;
    if (i % 5 === 0) row.extra = { note: 'n' + i };
    rows.push(row);
  }
  return { meta: { title: 'catalog', count: ROWS }, rows };
};
const sum = (catalog) => {
  let total = 0;
  for (let i = 0; i < catalog.rows.length; i++) {
    const row = catalog.rows[i];
    total += row.id + row.price + row.name.length + row.tags[1].length;
    if (row.stock !== undefined) total += row.stock;
    if (row.extra !== undefined) total += row.extra.note.length;
  }
  return total;
};
const intact = (row, i) =>
  row.id === i && row.name === 'item ' + i && row.price === i + 0.25 &&
  row.tags[0] === 'a' && row.tags[1] === 'b' + (i % 7) &&
  (i % 3 !== 0 || row.stock === i % 50) &&
  (i % 5 !== 0 || row.extra.note === 'n' + i);
const regions = () => Region.stats().regions;
// Garbage in the shared heap between GCs, so that they have something to
// compact.
const churn = () => {
  for (let i = 0; i < 20; i++) Region.share({ i, junk: new Array(200).fill('j' + i) });
};

const expected = sum(build());
{
  const catalog = Region.share(build());
  const region = Region.of(catalog);
  check('sealed', region.sealed);
  check('on pages of its own', %RegionPageCount(region.id) > 0);
  check('read right after sealing', sum(catalog) === expected);
  for (let i = 0; i < 6; i++) {
    churn();
    gc();
  }
  check('intact after GCs', sum(catalog) === expected);
  check('its strings and keys too', catalog.meta.title === 'catalog' &&
        catalog.rows.every(intact));
}

// Region handles go only after a task, so the regions below are told by
// their pages: %RegionPageCount is 0 once the id of a region is released.
// A pointer to a row on the pages of the region keeps it.
let catalog = Region.share(build());
let row = catalog.rows[ROWS - 5];
const rowRegion = %RegionPageOf(row);
check('the row is on a page of the region', rowRegion >= 0);
catalog = null;
for (let i = 0; i < 4; i++) {
  churn();
  gc();
}
// Read here rather than in a function: a function that reads a region keeps
// it for now.
check('a row keeps the region', row.id === ROWS - 5 &&
      row.name === 'item ' + (ROWS - 5) && row.tags[1] === 'b' + ((ROWS - 5) % 7) &&
      row.extra.note === 'n' + (ROWS - 5) &&
      %RegionPageOf(row) === rowRegion && %RegionPageCount(rowRegion) > 0);

// So does a pointer to one of its first objects, which may be on a common
// page.
let first = Region.share(build());
const firstRegion = %RegionPageOf(first.rows[ROWS - 1]);
let meta = first.meta;
print('first object on a common page:', %RegionPageOf(meta) !== firstRegion);
first = null;
for (let i = 0; i < 4; i++) {
  churn();
  gc();
}
check('its first object keeps it', meta.title === 'catalog' &&
      meta.count === ROWS && %RegionPageCount(firstRegion) > 0);

// Without pointers, both are released.
row = null;
meta = null;
for (let i = 0; i < 4; i++) gc();
check('released once nothing refers to them',
      %RegionPageCount(rowRegion) === 0 && %RegionPageCount(firstRegion) === 0);

// Another isolate that holds a row keeps the region until it lets go.
{
  const reader = new Worker(
    `let row = null;
     onmessage = ({ data }) => {
       if (data.op === 'take') {
         row = data.catalog.rows[123];
         postMessage(row.name);
       } else if (data.op === 'check') {
         gc();
         postMessage(row.id === 123 && row.name === 'item 123' &&
                     row.tags[1] === 'b' + (123 % 7));
       } else if (data.op === 'drop') {
         row = null;
         gc();
         postMessage('dropped');
       }
     }`,
    { type: 'string' },
  );
  let shared = Region.share(build());
  reader.postMessage({ op: 'take', catalog: shared });
  check('the reader reads a row', reader.getMessage() === 'item 123');
  shared = null;
  for (let i = 0; i < 4; i++) {
    churn();
    gc();
  }
  reader.postMessage({ op: 'check' });
  check('the row stays intact at the reader', reader.getMessage() === true);
  const before = regions();
  reader.postMessage({ op: 'drop' });
  reader.getMessage();
  // The function of the reader that read the row would keep the region.
  reader.terminate();
  for (let i = 0; i < 4; i++) gc();
  check('released once the reader lets go', regions() < before);
}

// Marking that runs while the thread allocates, as in a server.
{
  const kept = Region.share(build());
  let garbage = [];
  for (let round = 0; round < 200000; round++) {
    garbage.push({ round, s: 'g' + round });
    if (garbage.length > 5000) garbage = [];
    if (round % 40000 === 0 && sum(kept) !== expected) {
      check('intact while allocating', false);
    }
  }
  check('intact after incremental marking', sum(kept) === expected);
}
print('done');

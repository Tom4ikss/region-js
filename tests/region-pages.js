// d8 --harmony-region-literals --allow-natives-syntax --expose-gc --verify-heap region-pages.js
// A region that holds --region-page-threshold bytes (64 KB) gets pages of its
// own in the shared heap. %RegionPageOf tells the region of the page an
// object is on, or -1 for a page anyone allocates on.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const pageOf = (object) => %RegionPageOf(object);
const onPagesOf = (region, objects) => objects.every((o) => pageOf(o) === region.id);

// Literals: the first ones live in the shared space, the rest on the pages.
function orders(region, from, count) {
  'use region';
  using _ = region.enter();
  const list = [];
  for (let i = from; i < from + count; i++) {
    list.push({ id: i, customer: { name: 'c' + (i % 10) }, items: [{ qty: 1 }, { qty: 2 }] });
  }
  return list;
}
const sum = (list) => list.reduce((s, o) => s + o.id + o.items[1].qty, 0);

const small = new Region();
const few = orders(small, 0, 10);
check('small region in the shared space', few.every((o) => pageOf(o) === -1));

const big = new Region();
const many = orders(big, 0, 5000);
check('big region on its pages', onPagesOf(big, many.slice(-1000)) &&
      onPagesOf(big, many.slice(-1000).map((o) => o.customer)));
check('the first objects stay', pageOf(many[0]) === -1);

// Two regions in turns: each object goes to the pages of its own region.
const left = new Region();
const right = new Region();
orders(left, 0, 2000);
orders(right, 0, 2000);
const a = [];
const b = [];
for (let i = 0; i < 300; i++) {
  a.push(...orders(left, i, 3));
  b.push(...orders(right, i, 3));
}
check('regions in turns', onPagesOf(left, a) && onPagesOf(right, b));

// The GC keeps the objects where they are.
const before = many.slice(-100).map(pageOf).join();
gc();
gc();
check('kept by the GC', many.slice(-100).map(pageOf).join() === before && sum(many) === 12507500);

// region.run(): the copy goes to the pages once the region is big enough.
const copied = new Region().run(() => {
  const list = [];
  for (let i = 0; i < 5000; i++) list.push({ id: i, items: [{ qty: 1 }, { qty: 2 }] });
  return list;
});
check('region.run on pages', onPagesOf(Region.of(copied), copied.slice(-1000)) &&
      sum(copied) === 12507500);

// Large values arrays get a large page marked with the region.
const wide = new Region().run(() => Array.from({ length: 50000 }, (_, i) => i));
check('large array', wide.length === 50000 && wide[49999] === 49999);

// Growing an array: the new values go to the pages.
const grown = new Region();
const list = orders(grown, 0, 3000);
{
  using _ = grown.enter();
  for (let i = 0; i < 1000; i++) list.push(#{ id: i, items: #[#{ qty: 1 }, #{ qty: 2 }] });
}
check('pushed objects on pages', onPagesOf(grown, list.slice(-100)) && list.length === 4000);

// Another owner continues on the pages of the region.
const moved = new Region();
const start = orders(moved, 0, 3000);
const w = new Worker(`
  ${orders.toString()}
  onmessage = ({ data }) => {
    const region = Region.of(data.start);
    const more = orders(region, 3000, 2000);
    postMessage([
      more.every((o) => %RegionPageOf(o) === region.id),
      data.start.slice(-10).every((o) => %RegionPageOf(o) === region.id),
      data.start.length + more.length,
    ]);
  };`, { type: 'string' });
w.postMessage({ start }, [moved]);
check('worker continues on the pages', w.getMessage().join() === 'true,true,5000');
w.terminate();

// Freed regions: their pages empty out and are given back.
for (let round = 0; round < 20; round++) {
  const r = new Region();
  orders(r, 0, 3000);
  r.free();
  if (round % 5 === 4) gc();
}
print('done');

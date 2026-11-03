// d8-flags: --module
// A counter that four tasks write and everyone reads at once.
const stats = new RwLock({ hits: 0, writers: [] });

await Promise.all([1, 2, 3, 4].map((worker) => spawn(async (stats, worker) => {
  for (let i = 0; i < 100; i++) {
    using g = await stats.write();   // one writer at a time
    g.value.hits++;
    if (!g.value.writers.includes(worker)) g.value.writers.push(worker);
  }
}, stats, worker)));

let kept;
{
  using r = await stats.read();      // there can be many readers
  print('total:', r.value.hits, '| written by tasks', r.value.writers.toSorted().join(', '));
  kept = r.value;
  try {
    r.value.hits = 0;
  } catch (e) {
    print('write under read():', String(e));
  }
}
// The lock is released: the saved reference no longer works.
try {
  print(kept.hits);
} catch (e) {
  print('after release:', String(e));
}

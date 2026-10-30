// d8 --harmony-regions --module rwlock.js
// A counter shared by four tasks through an RwLock.
const stats = new RwLock({ hits: 0, last: '' });

await Promise.all([1, 2, 3, 4].map((worker) => spawn(async (stats, worker) => {
  for (let i = 0; i < 100; i++) {
    using g = await stats.write();
    g.value.hits++;
    g.value.last = `worker ${worker}`;
  }
}, stats, worker)));

using r = await stats.read();
print(r.value.hits, r.value.last);

// d8 --harmony-regions --module --expose-gc --verify-heap port-stress.js
// Many tasks with region objects in flight while shared GCs run: objects
// queued in task ports must survive and keep their identity.
spawn.poolSize = 4;
const rounds = 20;
let ok = 0;
for (let round = 0; round < rounds; round++) {
  const states = Array.from({ length: 16 }, (_, i) =>
      new Region().run(() => ({ id: i, hits: 0, items: Array.from({ length: 50 }, (_, j) => ({ j })) })));
  const results = await Promise.all(states.map((state, i) => spawn((s, salt) => {
    // Garbage and GCs in the worker while other tasks are queued.
    let junk = [];
    for (let k = 0; k < 2000; k++) junk.push({ k, salt });
    if (salt % 3 === 0) gc();
    s.hits++;
    return { id: s.id, sum: s.items.reduce((a, it) => a + it.j, 0), salt };
  }, state, i)));
  if (round % 5 === 0) gc();
  for (let i = 0; i < states.length; i++) {
    if (states[i].hits === 1 && results[i].id === i && results[i].sum === 1225 && results[i].salt === i) ok++;
  }
}
print('consistent tasks:', ok, 'of', rounds * 16);

// Frozen region shared by many concurrent tasks, with GCs.
const config = new Region().run(() => ({ name: 'prod', weights: new Float64Array([0.5, 1.5]) }));
Region.of(config).freeze();
const reads = await Promise.all(Array.from({ length: 64 }, (_, i) => spawn(() => {
  if (i % 8 === 0) gc();
  return config.name + ':' + (config.weights[0] + config.weights[1]);
})));
print('frozen reads:', new Set(reads).size === 1 ? reads[0] : 'MISMATCH ' + reads.join(','));
Region.of(config).thaw();

// d8 --harmony-regions --expose-gc --verify-heap sealed.js
// A sealed region is frozen for good, like Arc<T>: every thread reads it
// without a borrow and without a copy, nobody can change, thaw or free it, and
// the GC releases it once nothing refers to it.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const errorOf = (fn) => {
  try {
    fn();
    return 'no error';
  } catch (e) {
    return e.message;
  }
};

// Region.share() copies the data in and seals the region.
const config = Region.share({
  name: 'prod',
  limits: [10, 20, 30],
  weights: new Float64Array([0.5, 1.5, 2.5]),
});
const region = Region.of(config);
check('sealed', region.sealed && region.frozen && !region.frozenHere);
check('read without a borrow', config.name === 'prod' && config.limits[2] === 30);
const weights = config.weights;
weights[0] = 99;
check('typed array view is immutable', weights[0] === 0.5 && weights.length === 3);
print('write:', errorOf(() => { config.name = 'dev'; }));
print('push:', errorOf(() => config.limits.push(40)));
print('thaw:', errorOf(() => region.thaw()));
print('free:', errorOf(() => region.free()));
print('seal again:', errorOf(() => region.seal()));
{
  // `using` leaves a sealed region to the GC.
  using disposed = Region.of(config);
}
print('share primitive:', errorOf(() => Region.share(1)));

// Sealing an owned region detaches its writable views.
{
  const owned = new Region();
  const state = owned.run(() => ({ bytes: new Uint8Array([1, 2, 3]) }));
  const writable = state.bytes;
  owned.seal();
  check('owner view detached on seal', writable.length === 0);
  check('fresh view after seal', state.bytes[2] === 3 && owned.sealed);
}

// A worker reads it without a borrow, also from optimized code.
const worker = new Worker(
  `onmessage = ({ data }) => {
     const sum = (c) => c.limits[0] + c.limits[1] + c.limits[2] + c.weights[1];
     let total = 0;
     for (let i = 0; i < 200000; i++) total += sum(data);
     const view = data.weights;
     postMessage({ total, view: [...view].join(','), name: data.name,
                   write: (() => { try { data.name = 'x'; return 'no error'; }
                                   catch (e) { return e.name; } })() });
   }`,
  { type: 'string' },
);
worker.postMessage(config);
const reply = worker.getMessage();
print('worker:', reply.total, reply.view, reply.name, reply.write);
check('worker read', reply.total === 200000 * 61.5);
worker.terminate();
print('transfer list:', errorOf(() => worker.postMessage(config, [region])));

// spawn() tasks read the same objects in parallel: nothing is copied.
const bytesBefore = Region.stats().bytes;
const tasks = [];
for (let t = 0; t < 4; t++) {
  tasks.push(spawn((config) => {
    let sum = 0;
    for (let i = 0; i < 100000; i++) sum += config.limits[i % 3];
    return [Region.of(config).id, Region.of(config).sealed, sum];
  }, config));
}
for (const task of tasks) {
  const [id, sealed, sum] = task.join();
  check('task reads the shared copy', id === region.id && sealed && sum === 1999990);
}
check('no copies made', Region.stats().bytes - bytesBefore < 1000);

// Through a channel.
{
  const ch = new Channel(1);
  spawn((ch, value) => ch.sendSync(value), ch, config).join();
  const { value } = ch.recvSync();
  check('channel shares it', value === config);
}

// Sealing a frozen region: borrows taken before still end normally, and views
// stay valid after them.
{
  const frozen = new Region();
  const data = frozen.run(() => ({ points: new Float64Array([1, 2]) }));
  frozen.freeze();
  const reader = new Worker(
    `onmessage = ({ data }) => {
       const borrow = Region.of(data).borrow();
       globalThis.points = data.points;
       globalThis.release = () => borrow.release();
       postMessage('borrowed');
       onmessage = ({ data }) => {
         release();
         postMessage(points.length + '/' + points[1] + '/' + Region.of(data).sealed);
       };
     }`,
    { type: 'string' },
  );
  reader.postMessage(data);
  print('reader:', reader.getMessage());
  check('readers before seal', frozen.readers === 1);
  frozen.seal();
  check('sealed while borrowed', frozen.sealed);
  reader.postMessage(data);
  print('view after borrow ends:', reader.getMessage());
  reader.terminate();
}

// Sealed regions nobody refers to are released by the GC.
{
  const before = Region.stats().regions;
  for (let i = 0; i < 100; i++) Region.share({ i, data: new Int32Array(16) });
  gc();
  gc();
  const after = Region.stats().regions;
  print('released by gc:', before + 100 > after);
  check('released', after < before + 100);
}
// A reused id does not keep the old mark: once a sealed region is released,
// a new frozen region with its id needs a borrow again.
{
  const reader = new Worker(
    `onmessage = ({ data }) => {
       if (data === 'gc') {
         gc();
         postMessage('collected');
         return;
       }
       try {
         postMessage('read ' + data.v);
       } catch (e) {
         postMessage(e.message);
       }
     }`,
    { type: 'string' },
  );
  let old = Region.share({ v: 1 });
  const oldId = Region.of(old).id;
  reader.postMessage(old);
  print('sealed read:', reader.getMessage());
  old = null;
  reader.postMessage('gc');
  reader.getMessage();
  gc();
  gc();
  let reused = null;
  const kept = [];
  for (let i = 0; i < 64 && !reused; i++) {
    const r = new Region();
    kept.push(r);
    if (r.id === oldId) reused = r;
  }
  check('id reused', reused !== null);
  const fresh = reused.run(() => ({ v: 2 }));
  reused.freeze();
  reader.postMessage(fresh);
  const message = reader.getMessage();
  print('frozen read with the old id:', message);
  check('needs a borrow again', message.includes('borrow it to read it'));
  reader.terminate();
}
check('still readable', config.limits.join() === '10,20,30');
print('done');

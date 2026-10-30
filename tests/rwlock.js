// d8 --harmony-regions --module --verify-heap rwlock.js
// RwLock: a region that threads take turns to write, or read together.
const attempt = (fn) => {
  try {
    return String(fn());
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};
const sleep = (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

// Guards give the object while they are held.
const lock = new RwLock({ hits: 0, log: [] });
{
  using g = await lock.write();
  g.value.hits++;
  g.value.log.push('main');
}
let kept;
{
  using r = await lock.read();
  kept = r.value;
  print('read:', r.value.hits, r.value.log.join(','));
  print('write under a read guard:', attempt(() => { r.value.hits = 5; }));
}
print('kept after release:', attempt(() => kept.hits));
{
  const g = lock.writeSync();
  g.release();
  print('released guard:', attempt(() => g.value));
  g.release();
}

// Writers from several threads: no update is lost.
spawn.poolSize = 4;
await Promise.all(Array.from({ length: 8 }, () => spawn(async () => {
  for (let i = 0; i < 200; i++) {
    using g = await lock.write();
    g.value.hits++;
  }
})));
{
  using r = lock.readSync();
  print('8 x 200 increments:', r.value.hits);
}

// Blocking guards in workers.
await Promise.all(Array.from({ length: 4 }, (_, k) => spawn((k) => {
  for (let i = 0; i < 100; i++) {
    using g = lock.writeSync();
    g.value.hits++;
  }
  using r = lock.readSync();
  return r.value.hits >= 100;
}, k)));
{
  using r = lock.readSync();
  print('4 x 100 blocking increments:', r.value.hits);
}

// Readers hold the lock together.
{
  const start = performance.now();
  const overlapped = await Promise.all(Array.from({ length: 4 }, () => spawn(() => {
    using r = lock.readSync();
    sleep(100);
    return r.value.hits;
  })));
  const took = performance.now() - start;
  print('4 readers of 100 ms together:', took < 300, overlapped.join(','));
}

// try*: null while the lock is taken the other way.
{
  using r = lock.tryRead();
  const second = lock.tryRead();
  print('while read: tryWrite', lock.tryWrite(), 'tryRead', second !== null);
  second.release();
}
{
  using g = lock.tryWrite();
  print('when free: tryWrite', g !== null);
}

// Fair order: a reader that comes after a waiting writer waits for it.
{
  const order = new Channel(10);
  const lock2 = new RwLock({ v: 0 });
  const first = await lock2.read();
  const writer = spawn(async (lock2, order) => {
    using g = await lock2.write();
    g.value.v = 1;
    await order.send('writer');
  }, lock2, order);
  // Let the writer queue up.
  sleep(50);
  const reader = spawn(async (lock2, order) => {
    using r = await lock2.read();
    await order.send('reader saw ' + r.value.v);
  }, lock2, order);
  sleep(50);
  first.release();
  await Promise.all([writer, reader]);
  print('order:', (await order.recv()).value, '|', (await order.recv()).value);
}

// What a locked region refuses.
{
  const lock3 = new RwLock([1, 2, 3]);
  using g = await lock3.write();
  const region = Region.of(g.value);
  print('free:', attempt(() => region.free()));
  print('freeze:', attempt(() => region.freeze()));
  print('postMessage:', attempt(() => {
    const w = new Worker('', { type: 'string' });
    try {
      w.postMessage(g.value, [region]);
    } finally {
      w.terminate();
    }
  }));
  const ch = new Channel(1);
  print('channel:', attempt(() => ch.sendSync(g.value)));
  print('new lock on it:', attempt(() => new RwLock(g.value)));
}
{
  const lock4 = new RwLock({ n: 1 });
  using r = await lock4.read();
  print('borrow:', attempt(() => Region.of(r.value).borrow()));
}
print('primitive:', attempt(() => new RwLock(5)));
{
  const frozen = new Region().run(() => ({ a: 1 }));
  Region.of(frozen).freeze();
  print('frozen region:', attempt(() => new RwLock(frozen)));
}
print('select on a lock:', attempt(() => Channel.selectSync([lock])));

// A region object owned here goes into the lock without a copy.
{
  const data = new Region().run(() => ({ items: [1, 2, 3] }));
  const lock5 = new RwLock(data);
  print('moved into the lock:', attempt(() => data.items.length));
  using g = lock5.writeSync();
  print('same object:', g.value === data, g.value.items.length);
}

// Typed arrays: views from a write guard are detached on release.
{
  const lock6 = new RwLock({ bytes: new Uint8Array([1, 2, 3]) });
  let view;
  {
    using g = lock6.writeSync();
    view = g.value.bytes;
    view[0] = 9;
  }
  using r = lock6.readSync();
  print('view after release:', view.length, 'reader sees:', r.value.bytes[0]);
}

// A thread that exits while holding the lock gives it up.
{
  const lock7 = new RwLock({ v: 0 });
  const w = new Worker(`onmessage = ({ data }) => {
    const g = data.writeSync();
    g.value.v = 7;
    postMessage('holding');
  };`, { type: 'string' });
  w.postMessage(lock7);
  print('worker:', w.getMessage());
  print('taken by the worker:', lock7.tryRead());
  w.terminate();
  using r = await lock7.read();
  print('after the worker exited:', r.value.v);
}

// The lock travels through channels; one lock on both sides.
{
  const ch = new Channel(1);
  await ch.send(lock);
  const back = (await ch.recv()).value;
  using r = back.readSync();
  print('through a channel:', back instanceof RwLock, r.value.hits);
}

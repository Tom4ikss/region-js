// Every line below is a mistake the editor should underline.
// Type errors come from types/regions.d.ts, lint errors from rules/*.grit.

class Point {
  constructor(x) {
    this.x = x;
  }
}

const region = new Region();

// Type error: class instances and Map cannot go into a region.
region.run(() => new Point(1));
region.run(() => new Map());

// Type error: regions have no such method.
region.frezee();

// Type error: a region holds only functions made by Region.fn().
region.run(() => ({ scale: (x) => x * 2 }));
const scaled = region.run(() => ({ scale: Region.fn((x) => x * 2) }));
scaled.scale(3);

// Type error: a Map stays in its thread; hold it through Region.localRef().
region.run(() => ({ cache: new Map() }));
const view = region.run(() => ({ cache: Region.localRef(new Map()) }));
view.cache.deref().set('key', 1);

// Type error: objects in a region have a fixed shape.
const state = region.run(() => ({ count: 0 }));
state.total = 1;

// Lint error: no classes inside spawn callbacks.
spawn(() => {
  class Local {}
  return new Local() ? 1 : 0;
});

// Lint error: no eval in spawn callbacks.
spawn(() => eval('1 + 1'));

// Lint error: a method cannot be sent to a worker.
spawn(Math.max, 1, 2);

// ESLint error: `counter` is in the worker until the task finishes.
const counter = new Region().run(() => ({ value: 0 }));
const counting = spawn(() => { counter.value++; });
print(counter.value);
await counting;

// ESLint error: `stats` is plain data, the task changes its own copy.
const stats = { batches: 0 };
await spawn((stats) => { stats.batches++; }, stats);

// ESLint error: `batch` went to the receiver with its region.
const batches = new Channel(1);
const batch = new Region().run(() => ({ rows: [1, 2] }));
await batches.send(batch);
print(batch.rows.length);

// ESLint warning: the write lock is held across the await.
const lock = new RwLock({ served: 0, prices: { tea: 3 } });
{
  using g = await lock.write();
  await batches.recv();
  g.value.served++;
}

// ESLint error: `prices` is used after its guard is released.
let prices;
{
  using r = await lock.read();
  prices = r.value.prices;
}
print(prices.tea);

// ESLint warning: the region can be thawed while the await waits.
const shared = new Region();
const config = shared.run(() => ({ limit: 10 }));
shared.freeze();
if (shared.frozen) {
  await batches.recv();
  using _borrow = shared.borrow();
  print(config.limit);
}

// Lint warning: nobody awaits this task, its result and errors are lost.
spawn(() => 1);

// Lint warning: join() blocks the thread; prefer await.
const value = spawn(() => 42).join();
print(value);

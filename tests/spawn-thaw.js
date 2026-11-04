// d8 --harmony-regions --module spawn-thaw.js
// A frozen region given to spawn() is borrowed from the call until the task
// ends, also while the task waits in the queue; region.thawWhenFree() waits
// for the readers to go.
const check = (name, ok, detail = '') => {
  print((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ': ' + detail : ''));
};
const outcome = async (promise) => {
  try {
    return 'value ' + JSON.stringify(await promise);
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};
const busy = (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};
const tryThaw = (region) => {
  try {
    region.thaw();
    return 'thawed';
  } catch (e) {
    return `${e.name} (${e.reason}): ${e.message}`;
  }
};

// A queued task already borrows: thaw() fails, and the task reads the value
// it was given.
{
  spawn.poolSize = 1;
  const cfg = new Region().run(() => ({ limit: 10 }));
  const region = Region.of(cfg);
  region.freeze();
  const blocker = spawn(() => {
    const end = performance.now() + 50;
    while (performance.now() < end);
  });
  const queued = spawn((cfg) => cfg.limit, cfg);
  check('borrowed at spawn()', region.readers === 1, String(region.readers));
  const thaw = tryThaw(region);
  check('thaw() fails while queued', thaw.startsWith('OwnershipError (borrowed)'), thaw);
  check('task reads the old value', (await outcome(queued)) === 'value 10');
  await blocker;
  check('borrow ends with the task', region.readers === 0, String(region.readers));
  check('thaw() after the task', tryThaw(region) === 'thawed');
  spawn.poolSize = 4;
}

// One borrow per task, whether it waits in the queue or runs.
{
  const cfg = new Region().run(() => ({ n: 1 }));
  const region = Region.of(cfg);
  region.freeze();
  const tasks = [];
  for (let i = 0; i < 8; i++) {
    tasks.push(spawn(async (cfg) => {
      await null;
      const end = performance.now() + 20;
      while (performance.now() < end);
      return cfg.n;
    }, cfg));
  }
  check('eight tasks, eight readers', region.readers === 8, String(region.readers));
  busy(10);
  check('still eight once some run', region.readers === 8, String(region.readers));
  const results = await Promise.all(tasks.map(outcome));
  check('all read', results.every((r) => r === 'value 1'), results.join());
  check('none left', region.readers === 0, String(region.readers));
  const twice = spawn((a, b) => a === b, cfg, cfg);
  check('a region given twice is one reader', region.readers === 1,
        String(region.readers));
  check('the same object twice', (await outcome(twice)) === 'value true');
  region.thaw();
}

// thawWhenFree() waits for the tasks, then the region is writable.
{
  const cfg = new Region().run(() => ({ version: 0 }));
  const region = Region.of(cfg);
  region.freeze();
  const tasks = [0, 1, 2].map(() => spawn(async (cfg) => {
    const end = performance.now() + 30;
    while (performance.now() < end);
    return cfg.version;
  }, cfg));
  const start = performance.now();
  await region.thawWhenFree();
  const took = performance.now() - start;
  check('waited for the tasks', took >= 25, Math.round(took) + ' ms');
  cfg.version = 1;
  check('writable', cfg.version === 1 && !region.frozen);
  const results = await Promise.all(tasks.map(outcome));
  check('tasks read the frozen value', results.every((r) => r === 'value 0'),
        results.join());
}

// Without readers it thaws at once; it fails as thaw() does otherwise.
{
  const cfg = new Region().run(() => ({}));
  const region = Region.of(cfg);
  region.freeze();
  const promise = region.thawWhenFree();
  check('no readers: thawed before the promise settles', !region.frozen);
  check('resolves to undefined', (await outcome(promise)) === 'value undefined');
  const notFrozen = await outcome(region.thawWhenFree());
  check('not frozen', notFrozen === 'OwnershipError: Region is not frozen by this isolate',
        notFrozen);
  region.seal();
  const sealed = await outcome(region.thawWhenFree());
  check('sealed', sealed.startsWith('OwnershipError: Region is sealed'), sealed);
}

// A borrow of this thread held across an await (trap 14): the wait ends when
// the handler releases it.
{
  const cfg = new Region().run(() => ({ price: 11 }));
  const region = Region.of(cfg);
  region.freeze();
  const handler = async () => {
    using b = region.borrow();
    const price = cfg.price;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return price;
  };
  const result = handler();
  await region.thawWhenFree();
  check('after the handler', !region.frozen && (await result) === 11);
}

// A borrow that nothing will release: a deadlock, not a hang.
{
  const cfg = new Region().run(() => ({}));
  const region = Region.of(cfg);
  region.freeze();
  const borrow = region.borrow();
  const result = await outcome(region.thawWhenFree());
  check('deadlock', result.startsWith('DeadlockError'), result);
  borrow.release();
  await region.thawWhenFree();
  check('then thawed', !region.frozen);
}

// Several waits: the first thaws, the others find it thawed.
{
  const cfg = new Region().run(() => ({}));
  const region = Region.of(cfg);
  region.freeze();
  const task = spawn((cfg) => {
    const end = performance.now() + 20;
    while (performance.now() < end);
  }, cfg);
  const first = region.thawWhenFree();
  const second = region.thawWhenFree();
  check('first thaws', (await outcome(first)) === 'value undefined');
  const result = await outcome(second);
  check('second fails', result === 'OwnershipError: Region is not frozen by this isolate',
        result);
  await task;
}

// The borrow is given back when spawn() fails, and when a queued task is
// aborted.
{
  const cfg = new Region().run(() => ({}));
  const region = Region.of(cfg);
  region.freeze();
  const failed = await outcome((async () => spawn((cfg, f) => f, cfg, () => {}))());
  check('spawn() failed', failed.startsWith('TypeError'), failed);
  check('no borrow left', region.readers === 0, String(region.readers));
  // The workers that earlier tasks started stay, whatever spawn.poolSize is
  // now: a blocker for each keeps the task in the queue.
  const blockers = Array.from({ length: spawn.poolSize }, () => spawn(() => {
    const end = performance.now() + 30;
    while (performance.now() < end);
  }));
  const queued = spawn((cfg) => 1, cfg);
  queued.abort();
  const aborted = await outcome(queued);
  check('queued task aborted', aborted.startsWith('AbortError'), aborted);
  check('its borrow given back', region.readers === 0, String(region.readers));
  await Promise.all(blockers);
  region.thaw();
}

// In a task, the wait fails with the task's abort.
{
  const task = spawn(async () => {
    const cfg = new Region().run(() => ({}));
    const region = Region.of(cfg);
    region.freeze();
    const borrow = region.borrow();
    try {
      await region.thawWhenFree();
    } finally {
      borrow.release();
    }
  });
  busy(20);
  task.abort();
  const result = await outcome(task);
  check('aborted wait', result.startsWith('AbortError'), result);
}
print('done');

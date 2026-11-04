// d8 --harmony-regions --module --expose-gc spawn-cancel-gc.js
// An aborted task whose code waits for a promise nothing refers to still
// unwinds after a full GC: its catch and finally blocks run, and a write
// guard it holds poisons the lock. The isolate holds the promises that task
// code awaits until they settle or the task ends.
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

spawn.poolSize = 1;

// Nested async functions waiting for a promise nobody holds, then a GC on
// the same worker before the abort.
{
  const log = new Region().run(() => []);
  const lock = new RwLock({ n: 0 });
  const started = new Channel(1);
  const task = spawn(async (log, lock, started) => {
    const inner = async () => {
      try {
        await new Promise(() => {});
      } finally {
        log.push('inner finally');
      }
    };
    using g = await lock.write();
    g.value.n = 1;
    await started.send(1);
    try {
      await inner();
    } catch (e) {
      log.push('outer caught ' + e.name);
    }
  }, log, lock, started);
  await started.recv();
  await spawn(() => { gc(); gc(); });
  task.abort();
  const result = await outcome(task);
  check('task fails', result.startsWith('AbortError'), result);
  check('cleanup ran', log.join(', ') === 'inner finally, outer caught AbortError',
        log.join(', '));
  check('lock poisoned', lock.poisoned === true);
}

// Promise.all and an async generator waiting at the same time.
{
  const log = new Region().run(() => []);
  const started = new Channel(1);
  const task = spawn(async (log, started) => {
    async function* ticks() {
      try {
        yield 1;
        await new Promise(() => {});
      } finally {
        log.push('generator finally');
      }
    }
    const all = (async () => {
      try {
        await Promise.all([new Promise(() => {}), Promise.resolve(1)]);
      } catch (e) {
        log.push('all: ' + e.name);
      }
    })();
    const loop = (async () => {
      try {
        for await (const tick of ticks()) log.push('tick ' + tick);
      } catch (e) {
        log.push('for await: ' + e.name);
      }
    })();
    await started.send(1);
    await all;
    await loop;
  }, log, started);
  await started.recv();
  await spawn(() => { gc(); gc(); });
  task.abort();
  await outcome(task);
  check('Promise.all and generator', [...log].sort().join(', ') ===
        'all: AbortError, for await: AbortError, generator finally, tick 1',
        [...log].sort().join(', '));
}

// Code that a finished task left waiting is not kept once the task ends.
{
  await spawn(() => {
    const never = new Promise(() => {});
    globalThis.leftBehind = new WeakRef(never);
    (async () => { await never; })();
  });
  const collected = await spawn(() => {
    gc();
    gc();
    return globalThis.leftBehind.deref() === undefined;
  });
  check('finished task forgotten', collected === true);
}
spawn.poolSize = 4;
print('done');

// d8 --harmony-regions --module spawn-cancel.js
// Cancellation: an aborted task throws at its awaits, also at one that waits
// for a promise that never settles, and a writer aborted while holding an
// RwLock poisons it.
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

// Waiting for a timer: the handle rejects at the timeout, not when the timer
// fires, and the code after the await does not run.
{
  const doc = new Region().run(() => ({ title: '', words: 0 }));
  const started = new Channel(1);
  const task = spawn(async (doc, started) => {
    const sleep = (ms) => new Promise((resolve) => {
      const end = performance.now() + ms;
      const tick = () => (performance.now() >= end ? resolve() : setTimeout(tick, 0));
      tick();
    });
    doc.title = 'final';
    await started.send(1);
    await sleep(500);
    doc.words = 1000;
  }, doc, started);
  await started.recv();
  const start = performance.now();
  task.timeout(30);
  const result = await outcome(task);
  const took = performance.now() - start;
  check('timeout during a timer', result.startsWith('TimeoutError'), result);
  check('in time', took < 300, Math.round(took) + ' ms');
  check('nothing ran after the await', doc.title === 'final' && doc.words === 0,
        JSON.stringify(doc));
}

// A promise that never settles: the task no longer hangs.
{
  const task = spawn(async () => {
    await new Promise(() => {});
  }).timeout(20);
  const result = await outcome(task);
  check('never-settling promise', result.startsWith('TimeoutError'), result);
}

// A task that returns such a promise without awaiting it.
{
  const task = spawn(() => new Promise(() => {}));
  busy(20);
  task.abort();
  const result = await outcome(task);
  check('returned promise', result.startsWith('AbortError'), result);
}

// Awaiting in a loop without ever waiting: the next await throws.
{
  const task = spawn(async () => {
    for (;;) await null;
  });
  busy(20);
  task.abort();
  const result = await outcome(task);
  check('loop of awaits', result.startsWith('AbortError'), result);
}

// Catch and finally blocks run before the handle settles, with the task's
// regions; inner functions unwind before outer ones; a later await throws
// again.
{
  const log = new Region().run(() => []);
  const task = spawn(async (log) => {
    const inner = async () => {
      try {
        await new Promise(() => {});
      } finally {
        log.push('inner finally');
      }
    };
    try {
      await inner();
    } catch (e) {
      log.push('outer caught ' + e.name);
      try {
        await Promise.resolve(1);
        log.push('second await went on');
      } catch (e2) {
        log.push('second await: ' + e2.name);
      }
    }
  }, log);
  busy(20);
  task.abort();
  const result = await outcome(task);
  check('task still fails', result.startsWith('AbortError'), result);
  check('cleanup in order', log.join(', ') ===
        'inner finally, outer caught AbortError, second await: AbortError',
        log.join(', '));
}

// Async generators and Promise.all are interrupted as well.
{
  const task = spawn(async () => {
    async function* ticks() {
      yield 1;
      await new Promise(() => {});
      yield 2;
    }
    let seen = 0;
    for await (const tick of ticks()) seen += tick;
    return seen;
  });
  busy(20);
  task.abort();
  check('async generator', (await outcome(task)).startsWith('AbortError'));
  const all = spawn(async () => {
    await Promise.all([new Promise(() => {}), Promise.resolve(1)]);
  });
  busy(20);
  all.abort();
  check('Promise.all', (await outcome(all)).startsWith('AbortError'));
}

// Other tasks of the same worker go on.
{
  spawn.poolSize = 1;
  const never = spawn(async () => {
    await new Promise(() => {});
  });
  const other = spawn(async () => {
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += await Promise.resolve(i);
    return sum;
  });
  busy(20);
  never.abort();
  check('aborted', (await outcome(never)).startsWith('AbortError'));
  check('neighbour unaffected', (await outcome(other)) === 'value 4950');
  const later = await outcome(spawn(async () => {
    await null;
    return 'later';
  }));
  check('later task unaffected', later === 'value "later"', later);
  spawn.poolSize = 4;
}

// A scope in an aborted task still waits for its tasks: they are aborted
// with it, and their regions are back before the task ends.
{
  const data = new Region().run(() => ({ steps: [] }));
  const started = new Channel(1);
  const task = spawn(async (data, started) => spawn.scope(async (s) => {
    s.spawn(async (data, started) => {
      try {
        await started.send(1);
        await new Promise(() => {});
      } finally {
        data.steps.push('child cleaned up');
      }
    }, data, started);
    await new Promise(() => {});
  }), data, started);
  await started.recv();
  task.abort();
  const result = await outcome(task);
  check('task with a scope', result.startsWith('AbortError'), result);
  check('child ended first', data.steps.join() === 'child cleaned up',
        data.steps.join());
}

// A writer aborted while it holds the lock poisons it.
{
  const lock = new RwLock({ inFlight: 0, served: 0 });
  const task = spawn(async (lock) => {
    using g = await lock.write();
    g.value.inFlight++;
    await new Promise(() => {});
    g.value.inFlight--;
    g.value.served++;
  }, lock);
  busy(30);
  task.abort();
  check('writer aborted', (await outcome(task)).startsWith('AbortError'));
  check('lock poisoned', lock.poisoned === true);
  const refused = await outcome(lock.write());
  check('write refused', refused.startsWith('PoisonError: the RwLock is poisoned'),
        refused);
  check('PoisonError class', (() => {
    try {
      lock.tryRead();
    } catch (e) {
      return e instanceof PoisonError && e instanceof Error;
    }
    return false;
  })());
  lock.clearPoison();
  check('poison cleared', lock.poisoned === false);
  using g = await lock.write();
  check('value as the writer left it',
        g.value.inFlight === 1 && g.value.served === 0,
        JSON.stringify(g.value));
}

// A guard that a task leaves behind is released when the task ends; if the
// task failed, a write guard poisons the lock.
{
  const lock = new RwLock({ n: 0 });
  await spawn(async (lock) => {
    const g = await lock.write();
    g.value.n = 1;
  }, lock);
  check('left by a finished task', lock.poisoned === false &&
        (await outcome((async () => {
          using g = await lock.read();
          return g.value.n;
        })())) === 'value 1');
  const failed = spawn(async (lock) => {
    const g = await lock.write();
    g.value.n = 2;
    throw new RangeError('half done');
  }, lock);
  const result = await outcome(failed);
  check('task failed', result === 'RangeError: half done', result);
  const refused = await outcome(lock.read());
  check('left by a failed task', refused.includes('its task failed while holding it'),
        refused);
  lock.clearPoison();
}

// Readers and writers that finish do not poison it.
{
  const lock = new RwLock({ n: 0 });
  await spawn(async (lock) => {
    using g = await lock.write();
    g.value.n++;
  }, lock);
  const reader = spawn(async (lock) => {
    using g = await lock.read();
    await new Promise(() => {});
    return g.value.n;
  }, lock);
  busy(30);
  reader.abort();
  await outcome(reader);
  check('not poisoned by a reader', lock.poisoned === false);
}

// spawn.shield(): cleanup that the abort does not interrupt. The handle
// settles after it; awaiting the shield then throws the abort, unless the
// shield failed, whose error comes as it is.
{
  const state = new RwLock({ inFlight: 0, served: 0 });
  const log = new Region().run(() => []);
  const task = spawn(async (state, log) => {
    {
      using g = await state.write();
      g.value.inFlight++;
    }
    try {
      await new Promise(() => {});
      log.push('work done');
    } finally {
      log.push('aborted: ' + spawn.aborted());
      try {
        await spawn.shield(async () => {
          log.push('in shield: ' + spawn.aborted());
          await Promise.resolve();
          using g = await state.write();
          g.value.inFlight--;
          log.push('cleaned up');
          return 'cleanup value';
        });
      } catch (e) {
        log.push('after shield: ' + e.name);
      }
      try {
        await spawn.shield(() => {
          throw new RangeError('cleanup failed');
        });
      } catch (e) {
        log.push('failed shield: ' + e.name);
      }
    }
  }, state, log);
  busy(30);
  task.abort();
  const result = await outcome(task);
  check('shielded task still aborted', result.startsWith('AbortError'), result);
  check('shield ran to the end', log.join(', ') ===
        'aborted: true, in shield: false, cleaned up, after shield: AbortError, ' +
        'failed shield: RangeError', log.join(', '));
  check('lock not poisoned', state.poisoned === false);
  using g = await state.read();
  check('invariant kept', g.value.inFlight === 0, JSON.stringify(g.value));
}

// A shield nobody awaits still ends before the task; waits in it and tasks
// it spawns are not aborted.
{
  const ch = new Channel(1);
  const log = new Region().run(() => []);
  const task = spawn(async (ch, log) => {
    spawn.shield(async () => {
      const child = spawn(async (ch) => (await ch.recv()).value, ch);
      log.push('child got ' + await child);
    });
    await new Promise(() => {});
  }, ch, log);
  busy(30);
  task.abort();
  busy(30);
  await ch.send(7);
  const result = await outcome(task);
  check('task aborted', result.startsWith('AbortError'), result);
  check('shield ended first', log.join() === 'child got 7', log.join());
}

// Outside a task, and in a task that is not aborted, it just runs fn.
{
  check('outside a task', (await spawn.shield(async () => 'here')) === 'here');
  const value = await outcome(spawn(async () => spawn.shield(async () => {
    await null;
    return 'shielded';
  })));
  check('not aborted', value === 'value "shielded"', value);
  check('bad argument', (await outcome(spawn.shield(1))).startsWith('TypeError'));
}

// spawn.shield(fn, { timeout }): cleanup that hangs is aborted with a
// TimeoutError after the timeout, so the task still ends.
{
  const log = new Region().run(() => []);
  const start = performance.now();
  const task = spawn(async (log) => {
    try {
      await new Promise(() => {});
    } finally {
      try {
        await spawn.shield(async () => {
          try {
            await new Promise(() => {});
          } finally {
            log.push('shield cleanup: ' + spawn.aborted());
          }
        }, { timeout: 40 });
      } catch (e) {
        log.push('shield: ' + e.name + ': ' + e.message);
      }
    }
  }, log);
  busy(20);
  task.abort();
  const result = await outcome(task);
  const took = performance.now() - start;
  check('hung shield, task still aborted', result.startsWith('AbortError'), result);
  check('ended at the deadline', took < 400, Math.round(took) + ' ms');
  check('shield timed out', log.join(', ') === 'shield cleanup: true, shield: ' +
        'TimeoutError: spawn.shield() did not finish in 40 ms', log.join(', '));
}

// The deadline holds whether or not the task is aborted; a shield that ends
// in time is not aborted later, and the task goes on.
{
  const value = await outcome(spawn(async () => {
    const fast = await spawn.shield(async () => {
      await null;
      return 'fast';
    }, { timeout: 30 });
    let slow;
    try {
      await spawn.shield(() => new Promise(() => {}), { timeout: 30 });
    } catch (e) {
      slow = e.name;
    }
    const end = performance.now() + 60;
    while (performance.now() < end);
    await null;
    return [fast, slow, spawn.aborted()];
  }));
  check('in time and too slow', value === 'value ["fast","TimeoutError",false]', value);
}

// It aborts the shield's own waits and tasks, not those of other shields.
// A shield that did not finish in time fails with the TimeoutError even if
// its code caught it: its awaits throw it from then on.
{
  const ch = new Channel(1);
  const never = new Channel(1);
  const log = new Region().run(() => []);
  const task = spawn(async (ch, never, log) => {
    let child;
    const timed = spawn.shield(async () => {
      child = spawn(async (never) => { await never.recv(); }, never)
          .then(() => log.push('child: done'), (e) => log.push('child: ' + e.name));
      try {
        await never.recv();
      } catch (e) {
        log.push('wait: ' + e.name);
      }
    }, { timeout: 30 });
    const other = spawn.shield(async () => {
      const { value } = await ch.recv();
      log.push('other got ' + value);
    });
    await timed.catch((e) => log.push('timed: ' + e.name));
    await ch.send(5);
    await other;
    await child;
  }, ch, never, log);
  const result = await outcome(task);
  check('task with a timed shield', result === 'value undefined', result);
  check('only the timed shield', [...log].sort().join(', ') ===
        'child: AbortError, other got 5, timed: TimeoutError, wait: TimeoutError',
        log.join(', '));
}

// A write guard held by a shield that times out poisons the lock.
{
  const lock = new RwLock({ n: 0 });
  const result = await outcome(spawn(async (lock) => {
    try {
      await spawn.shield(async () => {
        using g = await lock.write();
        g.value.n = 1;
        await new Promise(() => {});
      }, { timeout: 20 });
    } catch (e) {
      return e.name;
    }
  }, lock));
  check('shield timed out holding the lock', result === 'value "TimeoutError"', result);
  check('lock poisoned', lock.poisoned === true);
  check('bad timeout',
        (await outcome(spawn.shield(() => 1, { timeout: -1 }))).startsWith('TypeError'));
}

// Code that never awaits still has to check spawn.aborted().
{
  const task = spawn(() => {
    let rounds = 0;
    while (!spawn.aborted()) rounds++;
    return rounds;
  });
  busy(20);
  task.abort();
  check('busy loop', (await outcome(task)).startsWith('AbortError'));
}
print('done');

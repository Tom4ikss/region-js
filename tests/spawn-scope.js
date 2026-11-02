// d8 --harmony-regions --module spawn-scope.js
// spawn.scope(): tasks end with the scope, the first failure aborts the rest.
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

// The scope gives what its function returned, after every task finished:
// regions moved into the tasks are back.
{
  const totals = new Region().run(() => ({ a: 0, b: 0 }));
  const value = await spawn.scope(async (s) => {
    s.spawn((totals) => { totals.a = 1; }, totals);
    return 'body';
  });
  check('value of the function', value === 'body', value);
  check('regions are back after the scope', totals.a === 1, String(totals.a));
}

// A failing task fails the scope with its own error, aborts the others and
// closes the scope's channels, so that nobody waits for it.
{
  const log = [];
  const result = await outcome(spawn.scope(async (s) => {
    const work = s.channel(1);
    const waiting = s.spawn(async (work) => (await work.recv()).value, work);
    s.spawn(() => { throw new RangeError('task failed'); });
    for await (const item of work) log.push(item);
    log.push('loop ended');
    log.push('waiting: ' + await outcome(waiting));
  }));
  check('scope fails with the task error', result === 'RangeError: task failed', result);
  check('its channel is closed', log[0] === 'loop ended');
  // Aborted, or woken by the closed channel first.
  const ended = /^waiting: (AbortError|value)/.test(log[1]);
  check('the other task ends', ended, ended ? '' : log[1]);
}

// The function failing aborts the tasks; the scope still waits for them.
{
  let finished = false;
  const result = await outcome(spawn.scope(async (s) => {
    const forever = s.channel(1);
    s.spawn(async (forever) => { await forever.recv(); }, forever).then(
        () => { finished = true; }, () => { finished = true; });
    throw new TypeError('function failed');
  }));
  check('scope fails with the function error', result === 'TypeError: function failed', result);
  check('the task finished before the scope', finished);
}

// The first error wins; errors of aborted tasks are not reported.
{
  const result = await outcome(spawn.scope(async (s) => {
    const first = s.spawn(() => { throw new Error('first'); });
    await outcome(first);
    throw new Error('second');
  }));
  check('first error wins', result === 'Error: first', result);
}

// A task aborted through its handle does not fail the scope; a timeout does.
{
  const aborted = await outcome(spawn.scope(async (s) => {
    const ch = s.channel(1);
    s.spawn(async (ch) => { await ch.recv(); }, ch).abort();
    return 'fine';
  }));
  check('handle.abort() is not a failure', aborted === 'value "fine"', aborted);
  const timedOut = await outcome(spawn.scope(async (s) => {
    const ch = s.channel(1);
    s.spawn(async (ch) => { await ch.recv(); }, ch).timeout(10);
  }));
  check('handle.timeout() fails the scope', timedOut.startsWith('TimeoutError'), timedOut);
}

// closeAfter(): the output closes after the last of several senders, and a
// scope that closed it already makes it do nothing.
{
  const fanIn = async (fail) => spawn.scope(async (s) => {
    const out = s.channel(4);
    const senders = [0, 1, 2].map((i) => s.spawn(async (out, i, fail) => {
      if (fail && i === 1) throw new RangeError('sender failed');
      await out.send(i);
    }, out, i, fail));
    s.closeAfter(out, senders);
    let sum = 0;
    for await (const i of out) sum += i;
    return sum;
  });
  const ok = await outcome(fanIn(false));
  check('closeAfter closes after the last sender', ok === 'value 3', ok);
  const failed = await outcome(fanIn(true));
  check('closeAfter after a failed scope', failed === 'RangeError: sender failed', failed);
}

// No task starts once the scope ended or failed.
{
  let kept;
  await spawn.scope(async (s) => { kept = s; });
  check('spawn after the end throws',
        (await outcome((async () => kept.spawn(() => 1))())).startsWith('TypeError'));
  const result = await outcome(spawn.scope(async (s) => {
    s.fail(new Error('stop'));
    s.spawn(() => 1);
  }));
  check('s.fail() fails the scope, then spawn throws', result === 'Error: stop', result);
}

// The scope cannot be sent into a task.
{
  const result = await outcome(spawn.scope(async (s) => {
    s.spawn(() => s.spawn(() => 1));
  }));
  check('the scope stays in its thread', result.startsWith('TypeError'), result);
}

// Scopes nest in tasks; aborting the task aborts the tasks of its scope.
{
  const result = await outcome(spawn.scope(async (s) => {
    s.spawn(async () => spawn.scope(async (inner) => {
      const ch = inner.channel(1);
      for (let i = 0; i < 3; i++) inner.spawn(async (ch) => { await ch.recv(); }, ch);
      throw new SyntaxError('inner failed');
    }));
  }));
  check('inner scope error reaches the outer scope', result === 'SyntaxError: inner failed', result);
}

// The pipeline of research/async-traps.md, trap 2: every pricer fails. Without
// a scope the producer and the main thread end in a DeadlockError.
{
  const result = await outcome(spawn.scope(async (s) => {
    const raw = s.channel(2);
    const priced = s.channel(2);
    s.spawn(async (raw) => {
      for (let b = 0; b < 12; b++) {
        await raw.send(new Region().run(() => ({ orders: [{ qty: 1, price: 2 }] })));
      }
      raw.close();
    }, raw);
    for (let w = 0; w < 3; w++) {
      s.spawn(async (raw, priced) => {
        for await (const batch of raw) {
          for (const o of batch.orders) o.total = o.qty * o.price;
          await priced.send(batch);
        }
      }, raw, priced);
    }
    let count = 0;
    for await (const batch of priced) count++;
    return count;
  }));
  check('pipeline fails with the cause, not a deadlock',
        result.startsWith('TypeError: Cannot add property total'), result);
}
print('done');

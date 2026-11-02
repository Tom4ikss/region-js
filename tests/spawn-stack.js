// d8 --harmony-regions --module --expose-gc spawn-stack.js
// The stack of a task's error goes on with the frames that called spawn():
// after the frames of the task, "at spawn()" and the caller's frames.
const check = (name, ok, detail = '') => {
  print((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ': ' + detail : ''));
};
const stackOf = async (promise) => {
  try {
    await promise;
    return '';
  } catch (e) {
    return String(e.stack);
  }
};
// The function names of the frames, "?" for anonymous ones, "|" for the
// "at spawn()" lines.
const frames = (stack) => stack.split('\n').slice(1).map((line) => {
  if (line.trim() === 'at spawn()') return '|';
  const m = line.match(/^\s+at (?:(\S+) \()?.*spawn-stack\.js:\d+:\d+\)?$/);
  return m ? (m[1] ?? '?') : null;
}).filter((name) => name !== null).join(' ');

function parse(row) {
  if (row.price < 0) throw new RangeError('negative price in row ' + row.id);
  return row.price;
}
function load(rows) {
  return spawn((rows) => rows.map(parse), rows);
}
async function main() {
  const rows = new Region().run(() => [{ id: 1, price: 5 }, { id: 2, price: -1 }]);
  return stackOf(load(rows));
}

{
  const stack = await main();
  check('task frames, then the caller', frames(stack) === 'parse ? | load main ?',
        frames(stack));
  check('first line', stack.startsWith('RangeError: negative price in row 2'));
}

// Nested tasks: each spawn() adds its caller.
{
  function outer() {
    return spawn(async () => {
      const inner = () => spawn(() => { throw new Error('deep'); });
      await inner();
    });
  }
  const stack = await stackOf(outer());
  check('nested', frames(stack) === '? | inner ? | outer ?', frames(stack));
}

// An aborted task: where it was started.
{
  function start() {
    return spawn(async () => { await new Promise(() => {}); });
  }
  const task = start();
  task.abort();
  const stack = await stackOf(task);
  check('aborted', stack.startsWith('AbortError') && frames(stack) === '| start ?',
        frames(stack));
}

// s.spawn() in a scope.
{
  async function run() {
    return spawn.scope(async (s) => {
      s.spawn(() => { throw new TypeError('in scope'); });
    });
  }
  const stack = await stackOf(run());
  check('scope', frames(stack) === '? | ? run ?', frames(stack));
}

// The same place after a GC, which drops the cache.
{
  const stacks = [];
  for (let i = 0; i < 2; i++) {
    stacks.push(await main());
    gc();
  }
  check('after gc', stacks[0] === stacks[1] &&
        frames(stacks[1]) === 'parse ? | load main ?', frames(stacks[1]));
}
print('done');

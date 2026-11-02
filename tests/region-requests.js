// d8 --harmony-regions --allow-natives-syntax --expose-gc --region-gc-pages=8 region-requests.js
// The owner of a region can collect or mark it only while no other isolate
// holds it (see region-holders.js and region-mark.js). After a move the old
// owners hold it until their own reports find no pointer to it, and an idle
// worker reports nothing. So the owner asks the other holders for a report:
// a task with young generation GCs that a worker runs between two messages.
// The last one to let go wakes the owner, which collects or marks the region.
// Only regions of 1 MB and more are worth GCs of others. Readers of a frozen
// region are asked after the thaw. d8 runs pending requests before and after
// worker.getMessage(), which runs no tasks. --no-region-gc-requests turns
// this off. While the shared heap is being marked owners collect nothing, so
// the checks fail under --stress-incremental-marking; under
// --stress-compaction every GC of the main thread is a shared one, and under
// --gc-interval shared GCs come so often that they collect the dropped
// regions before their owners do.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const sleep = (() => {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  return (ms) => Atomics.wait(cell, 0, 0, ms);
})();
// The main thread holds the regions it passes on, so it runs JS between the
// checks: that is where it gets the requests.
const waitFor = (fn) => {
  for (let i = 0; i < 500; i++) {
    if (fn()) return true;
    sleep(10);
  }
  return false;
};

// Builds a region and gives it away, then waits for messages: it runs no JS
// and no GC of its own.
const builder = new Worker(`
  function table(region, count) {
    'use region';
    using _ = region.enter();
    const rows = [];
    for (let i = 0; i < count; i++) rows.push({ id: i, round: 0, items: [{ qty: i }] });
    return rows;
  }
  onmessage = ({ data }) => {
    if (data.op === 'read') {
      using _ = Region.of(data.rows).borrow();
      postMessage(data.rows.reduce((sum, row) => sum + row.id, 0));
      return;
    }
    const region = new Region();
    const rows = table(region, data.count);
    postMessage({ rows, id: region.id }, [region]);
  };`, { type: 'string' });

const owner = new Worker(`
  let kept = null;
  function table(region, count) {
    'use region';
    using _ = region.enter();
    const rows = [];
    for (let i = 0; i < count; i++) rows.push({ id: i, round: 0, items: [{ qty: i }] });
    return rows;
  }
  function churn(rows, round) {
    'use region';
    using _ = Region.of(rows).enter();
    for (let i = 0; i < rows.length; i++) rows[i] = { id: i, round, items: [{ qty: i + round }] };
  }
  onmessage = ({ data }) => {
    if (data.op === 'take') {
      kept = data.rows;
      postMessage(%RegionHolderCount(data.id));
    } else if (data.op === 'freeze') {
      const region = new Region();
      kept = table(region, data.count);
      region.freeze();
      postMessage({ rows: kept, id: region.id });
    } else if (data.op === 'thaw') {
      Region.of(kept).thaw();
      postMessage(null);
    } else if (data.op === 'drop') {
      kept = null;
      gc();
      gc();
      postMessage(null);
    } else if (data.op === 'churn') {
      for (let i = 0; i < data.rounds; i++) churn(kept, data.round + i);
      postMessage(null);
    } else if (data.op === 'state') {
      postMessage([%RegionCollectedCount(), %RegionMarkedCount(),
                   %RegionHolderCount(data.id), %RegionPageCount(data.id),
                   kept && kept.every((row, i) => row.id === i && row.round === data.round)]);
    }
  };`, { type: 'string' });

// From the builder to the owner through the main thread: the builder, the
// main thread and the owner hold the region.
function pass(count) {
  builder.postMessage({ count });
  const { rows, id } = builder.getMessage();
  owner.postMessage({ op: 'take', rows, id }, [Region.of(rows)]);
  return [id, owner.getMessage()];
}
const state = (id, round = 0) => {
  owner.postMessage({ op: 'state', id, round });
  return owner.getMessage();
};

// A dropped region: the owner asks the others, and collects it once they let
// go.
{
  const [id, holders] = pass(10000);
  check('three holders after the move', holders === 3);
  const [collected] = state(id);
  owner.postMessage({ op: 'drop' });
  owner.getMessage();
  check('the owner collects it once the others let go',
        waitFor(() => state(id)[0] > collected));
  check('only the owner holds it', state(id)[2] === 1);
}

// A live region with garbage: the owner marks it once the others let go.
{
  const [id] = pass(2000);
  const [, marked] = state(id);
  const rounds = 150;
  for (let round = 1; round <= rounds; round += 10) {
    owner.postMessage({ op: 'churn', round, rounds: 10 });
    owner.getMessage();
  }
  const [, markedAfter, holders, , intact] = state(id, rounds);
  check('the owner marks it once the others let go', markedAfter - marked >= 3);
  check('only the owner holds it', holders === 1);
  check('the region intact', intact);
}

// A frozen region that another worker read: after the thaw the owner asks
// the reader, which let go of its borrow, and collects the region.
{
  owner.postMessage({ op: 'freeze', count: 10000 });
  const { rows, id } = owner.getMessage();
  builder.postMessage({ op: 'read', rows });
  check('the reader reads it', builder.getMessage() === 10000 * 9999 / 2);
  owner.postMessage({ op: 'thaw' });
  owner.getMessage();
  const [collected] = state(id);
  owner.postMessage({ op: 'drop' });
  owner.getMessage();
  check('the owner collects it once the reader lets go',
        waitFor(() => state(id)[0] > collected));
}

builder.terminate();
owner.terminate();
print('done');

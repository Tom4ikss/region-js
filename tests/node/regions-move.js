// node --harmony-regions regions-move.js
// A region moves between the main thread and a worker in the transfer list
// of postMessage(): its objects go by reference, so they are the same objects
// on both sides, and only the current owner may use them.
'use strict';
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');

const check = (name, ok) => {
  console.log('%s: %s', name, ok);
  if (!ok) process.exitCode = 1;
};

function table(region, count) {
  'use region';
  using _ = region.enter();
  const rows = [];
  for (let i = 0; i < count; i++) rows.push({ id: i, hits: 0 });
  return rows;
}

// Adds one hit to every row and sends the region back.
const worker = new Worker(`
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', ({ rows, first }) => {
    const region = Region.of(rows);
    if (first) {
      parentPort.postMessage({ owned: region.owned, same: rows[0] === first });
    }
    for (const row of rows) row.hits++;
    parentPort.postMessage({ rows }, [region]);
  });
`, { eval: true });

async function main() {
  const region = new Region();
  const rows = table(region, 1000);
  const first = rows[0];

  worker.postMessage({ rows, first }, [region]);
  const [{ owned, same }] = await once(worker, 'message');
  check('the worker owns the region', owned);
  check('the worker gets the same objects', same);
  check('the main thread does not own it', !region.owned);
  let error;
  try {
    rows[0].hits;
  } catch (e) {
    error = e;
  }
  check('the main thread cannot read it', error instanceof OwnershipError);

  let [{ rows: back }] = await once(worker, 'message');
  check('the main thread owns it again', region.owned);
  check('the same rows come back', back === rows && back[0] === first);

  const rounds = 1000;
  for (let i = 1; i < rounds; i++) {
    worker.postMessage({ rows: back }, [Region.of(back)]);
    [{ rows: back }] = await once(worker, 'message');
  }
  check('the same rows after 1000 round trips', back === rows);
  check('every row has 1000 hits',
        rows.every((row, i) => row.id === i && row.hits === rounds));
  // A region that arrives gets a new Region object; Region.of() gives the
  // newest one.
  check('Region.of() gives the region', Region.of(rows).id === region.id);

  let moveError;
  try {
    worker.postMessage(null, [new Region(), region, region]);
  } catch (e) {
    moveError = e;
  }
  check('a region twice in a transfer list throws', moveError !== undefined);
  await worker.terminate();
}

main();

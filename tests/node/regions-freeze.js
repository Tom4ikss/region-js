// node --harmony-regions regions-freeze.js
// A frozen region is read by several workers at once: they get its objects
// in messages without a transfer list and read them while they borrow the
// region. The thread that froze it thaws it once nobody borrows it, and it can
// hand that right to another thread in a transfer list.
'use strict';
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');

// The owner of a region is the id of its thread's isolate.
const here = new Region().owner;

const check = (name, ok) => {
  console.log('%s: %s', name, ok);
  if (!ok) process.exitCode = 1;
};

function table(region, count) {
  'use region';
  using _ = region.enter();
  const rows = [];
  for (let i = 0; i < count; i++) rows.push({ id: i, price: i % 100 });
  return rows;
}

const readerSource = `
  const { parentPort } = require('node:worker_threads');
  // The owner of a region is the id of its thread's isolate.
  const here = new Region().owner;
  let rows;
  let borrow;
  parentPort.on('message', ({ op, data }) => {
    if (op === 'try') {
      try {
        data[0].price;
        parentPort.postMessage('read');
      } catch (e) {
        parentPort.postMessage(e.constructor.name);
      }
    } else if (op === 'hold') {
      rows = data;
      borrow = Region.of(rows).borrow();
      parentPort.postMessage(rows.reduce((sum, row) => sum + row.price, 0));
    } else if (op === 'release') {
      borrow.release();
      parentPort.postMessage('released');
    } else if (op === 'thaw') {
      const region = Region.of(data);
      region.thaw();
      for (const row of data) row.price = 1;
      parentPort.postMessage({ owned: region.owner === here, rows: data }, [region]);
    }
  });
`;

async function ask(worker, message, transfer) {
  worker.postMessage(message, transfer);
  const [answer] = await once(worker, 'message');
  return answer;
}

async function main() {
  const region = new Region();
  const rows = table(region, 10000);
  region.freeze();
  check('frozen', region.frozen);
  check('the thread that froze it still reads it', rows[5].price === 5);
  let writeError;
  try {
    rows[5].price = 0;
  } catch (e) {
    writeError = e;
  }
  check('nobody writes a frozen region', writeError instanceof OwnershipError &&
        rows[5].price === 5);

  const workers = [];
  for (let i = 0; i < 4; i++) workers.push(new Worker(readerSource, { eval: true }));
  check('a worker without a borrow cannot read it',
        await ask(workers[0], { op: 'try', data: rows }) === 'OwnershipError');
  const sums = await Promise.all(workers.map((w) => ask(w, { op: 'hold', data: rows })));
  check('4 workers read it at once', sums.every((sum) => sum === 495000));
  check('4 readers', region.readers === 4);

  let thawError;
  try {
    region.thaw();
  } catch (e) {
    thawError = e;
  }
  check('no thaw while borrowed', thawError?.reason === 'borrowed' && region.frozen);

  await Promise.all(workers.map((w) => ask(w, { op: 'release' })));
  check('no readers', region.readers === 0);
  region.thaw();
  check('thawed', !region.frozen && region.owner === here);
  rows[5].price = 50;
  check('the owner writes again', rows[5].price === 50);

  // The right to thaw moves with the region in a transfer list.
  region.freeze();
  const answer = await ask(workers[1], { op: 'thaw', data: rows }, [region]);
  check('the worker that got it thaws and writes it',
        answer.owned && answer.rows === rows);
  check('back with the main thread', region.owner === here &&
        rows.every((row) => row.price === 1));

  await Promise.all(workers.map((w) => w.terminate()));
}

main();

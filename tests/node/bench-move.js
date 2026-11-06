// node --harmony-regions bench-move.js
// A table of rows goes to a worker, which changes one row and sends it back:
// as a copy (structured clone, what postMessage() does with plain objects)
// and as a region in the transfer list, where the rows go by reference.
// Each line is the median of the round trips, in microseconds. Without
// --harmony-regions only the copies are measured.
'use strict';
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');

const worker = new Worker(`
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', ({ rows, move }) => {
    rows[0].hits++;
    if (move) parentPort.postMessage({ rows }, [Region.of(rows)]);
    else parentPort.postMessage({ rows });
  });
`, { eval: true });

function plainTable(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: i, name: 'row ' + i, hits: 0, tags: ['a', 'b'] });
  }
  return rows;
}

function regionTable(region, count) {
  'use region';
  using _ = region.enter();
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: i, name: 'row ' + i, hits: 0, tags: ['a', 'b'] });
  }
  return rows;
}

const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];

async function roundTrips(rows, move, count) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    if (move) worker.postMessage({ rows, move }, [Region.of(rows)]);
    else worker.postMessage({ rows, move });
    [{ rows }] = await once(worker, 'message');
    times.push((performance.now() - start) * 1000);
  }
  return median(times);
}

async function main() {
  for (const size of [10, 1000, 10000, 100000]) {
    const count = size >= 100000 ? 15 : 101;
    const copy = await roundTrips(plainTable(size), false, count);
    if (typeof Region === 'undefined') {
      console.log('%s rows: copy %s µs', String(size).padStart(6),
                  copy.toFixed(0).padStart(7));
      continue;
    }
    const move = await roundTrips(regionTable(new Region(), size), true, count);
    console.log('%s rows: copy %s µs, move %s µs, %s×', String(size).padStart(6),
                copy.toFixed(0).padStart(7), move.toFixed(0).padStart(5),
                (copy / move).toFixed(1));
  }
  await worker.terminate();
}

main();

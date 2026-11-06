// node --harmony-regions bench-catalog.js [rows] [copy|frozen] [workers]
// One catalog for 8 workers: as a copy in every worker (postMessage() with a
// structured clone) and as one frozen region that the workers borrow. For
// each: the time until every worker has the catalog, the memory of the
// process, and how long a query over the whole catalog takes in a worker.
// Run copy and frozen in separate processes to compare the memory.
'use strict';
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');

const count = Number(process.argv[2] ?? 300000);
const workers = Number(process.argv[4] ?? 8);

function fill(rows) {
  for (let i = 0; i < count; i++) {
    rows.push({ id: i, name: 'item ' + i, price: i % 1000, tags: ['a', 'b'] });
  }
  return rows;
}

// The same rows in a region: 'use region' applies to the literals of this
// function only.
function regionCatalog(region) {
  'use region';
  using _ = region.enter();
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: i, name: 'item ' + i, price: i % 1000, tags: ['a', 'b'] });
  }
  return rows;
}

const source = `
  const { parentPort } = require('node:worker_threads');
  let rows;
  let frozen;
  const query = () => {
    let sum = 0;
    for (const row of rows) if (row.price < 500) sum += row.price;
    return sum;
  };
  parentPort.on('message', (message) => {
    if (message.rows) {
      rows = message.rows;
      frozen = message.frozen;
      parentPort.postMessage('got');
      return;
    }
    const borrow = frozen ? Region.of(rows).borrow() : null;
    query();
    const times = [];
    let sum;
    for (let i = 0; i < 9; i++) {
      const start = performance.now();
      sum = query();
      times.push(performance.now() - start);
    }
    borrow?.exit();
    times.sort((a, b) => a - b);
    parentPort.postMessage({ sum, ms: times[4] });
  });
`;

const mb = (bytes) => (bytes / 2 ** 20).toFixed(0);

async function run(name, rows, frozen) {
  const pool = [];
  for (let i = 0; i < workers; i++) {
    const worker = new Worker(source, { eval: true });
    pool.push(worker);
    await once(worker, 'online');
  }
  const start = performance.now();
  await Promise.all(pool.map((worker) => {
    worker.postMessage({ rows, frozen });
    return once(worker, 'message');
  }));
  const handOut = performance.now() - start;
  const results = await Promise.all(pool.map((worker) => {
    worker.postMessage({});
    return once(worker, 'message').then(([result]) => result);
  }));
  const rss = process.memoryUsage().rss;
  const query = results.map((r) => r.ms).sort((a, b) => a - b)[workers >> 1];
  console.log('%s: hand out %s ms, rss %s MB, query %s ms, sums agree %s',
              name.padEnd(6), handOut.toFixed(0).padStart(5), mb(rss).padStart(5),
              query.toFixed(1), results.every((r) => r.sum === results[0].sum));
  await Promise.all(pool.map((worker) => worker.terminate()));
}

async function main() {
  console.log('%d rows, %d workers', count, workers);
  if (process.argv[3] !== 'frozen') await run('copy', fill([]), false);
  if (typeof Region !== 'undefined' && process.argv[3] !== 'copy') {
    const region = new Region();
    const rows = regionCatalog(region);
    region.freeze();
    await run('frozen', rows, true);
  }
}

main();

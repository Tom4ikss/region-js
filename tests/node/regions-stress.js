// node --harmony-regions --expose-gc --allow-natives-syntax regions-stress.js [seconds]
// The engine under Node's workers: the main thread holds a region and keeps
// replacing its rows, which leaves garbage in the shared heap, while 8
// workers allocate and collect their own heaps. Every 25 rounds the main
// thread runs a shared GC, which stops all of them. At the end the rows are
// checked. Without --allow-natives-syntax there are no explicit shared GCs
// and no counters.
'use strict';
const { Worker } = require('node:worker_threads');

const seconds = Number(process.argv[2] ?? 10);
const natives = (() => {
  try {
    return {
      sharedGC: new Function('%SharedGC()'),
      counters: new Function(
        'return [%RegionCollectedCount(), %RegionMarkedCount()]'),
    };
  } catch {
    return null;
  }
})();
const check = (name, ok) => {
  console.log('%s: %s', name, ok);
  if (!ok) process.exitCode = 1;
};

function table(region, count) {
  'use region';
  using _ = region.enter();
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: i, round: 0, items: [{ qty: i }] });
  }
  return rows;
}

function churn(rows, round) {
  'use region';
  using _ = Region.of(rows).enter();
  for (let i = 0; i < rows.length; i++) {
    rows[i] = { id: i, round, items: [{ qty: i + round }] };
  }
}

const workers = [];
for (let i = 0; i < 8; i++) {
  workers.push(new Worker(`
    const { parentPort } = require('node:worker_threads');
    let stop = false;
    parentPort.on('message', () => { stop = true; });
    let rounds = 0;
    const step = () => {
      let keep = [];
      for (let i = 0; i < 200000; i++) {
        keep.push({ i, s: 'x' + i });
        if (keep.length > 50000) keep = [];
      }
      if (++rounds % 10 === 0) gc();
      if (stop) parentPort.postMessage(rounds);
      else setImmediate(step);
    };
    step();
  `, { eval: true }));
}

const region = new Region();
const rows = table(region, 100000);
check('rows in the region', Region.of(rows) === region &&
      Region.of(rows[99999]) === region);

const start = performance.now();
let round = 0;
let worst = 0;
const shared = { count: 0, total: 0, worst: 0 };
const tick = () => {
  const t = performance.now();
  churn(rows, ++round);
  worst = Math.max(worst, performance.now() - t);
  if (natives && round % 25 === 0) {
    const t = performance.now();
    natives.sharedGC();
    const ms = performance.now() - t;
    shared.count++;
    shared.total += ms;
    shared.worst = Math.max(shared.worst, ms);
  }
  if (performance.now() - start < seconds * 1000) {
    setImmediate(tick);
    return;
  }
  let pending = workers.length;
  let workerRounds = 0;
  for (const worker of workers) {
    worker.once('message', (n) => {
      workerRounds += n;
      worker.terminate();
      if (--pending === 0) done(workerRounds);
    });
    worker.postMessage('stop');
  }
};

function done(workerRounds) {
  console.log('main: %d rounds of 100000 rows, the slowest %s ms; workers: %d rounds',
              round, worst.toFixed(1), workerRounds);
  if (natives) {
    const [collected, marked] = natives.counters();
    console.log('%d shared GCs, %s ms on average, the slowest %s ms; ' +
                'regions collected %d, marked %d',
                shared.count, (shared.total / shared.count).toFixed(1),
                shared.worst.toFixed(1), collected, marked);
  }
  check('rows intact', rows.every((row, i) =>
    row.id === i && row.round === round && row.items[0].qty === i + round));
  check('rows still in the region', Region.of(rows[12345]) === region);
}

tick();

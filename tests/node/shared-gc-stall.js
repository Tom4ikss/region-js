// node --harmony-regions --allow-natives-syntax shared-gc-stall.js
// How long a shared-heap GC on the main thread waits for workers, depending on
// what the workers are doing. A shared GC stops every isolate of the process
// at a safepoint. JS code reaches one at the next interrupt check, and V8's
// own waits (Atomics.wait) park the isolate. A worker blocked in a system
// call that Node makes without parking, such as a synchronous read of a FIFO,
// cannot reach a safepoint until the call returns. The same holds for a worker
// that waits for a child process in spawnSync.
'use strict';
const { Worker } = require('node:worker_threads');
const { execSync, spawn } = require('node:child_process');
const { once } = require('node:events');

const sharedGC = () => {
  const start = performance.now();
  %SharedGC();
  return performance.now() - start;
};

const startWorker = async (source, workerData) => {
  const worker = new Worker(source, { eval: true, workerData });
  const [message] = await once(worker, 'message');
  return { worker, message };
};

async function main() {
  console.log('baseline, no workers: %s ms', sharedGC().toFixed(1));

  // Workers that compute and allocate: they reach a safepoint at once.
  const busy = [];
  for (let i = 0; i < 4; i++) {
    busy.push(await startWorker(`
      const { parentPort } = require('node:worker_threads');
      parentPort.postMessage('ready');
      let keep = [];
      for (;;) {
        keep.push({ i: keep.length, s: 'x' + keep.length });
        if (keep.length > 100000) keep = [];
      }
    `));
  }
  console.log('4 workers allocating: %s ms', sharedGC().toFixed(1));

  // A worker parked in Atomics.wait.
  const cell = new Int32Array(new SharedArrayBuffer(4));
  const parked = await startWorker(`
    const { parentPort, workerData } = require('node:worker_threads');
    parentPort.postMessage('ready');
    Atomics.wait(workerData, 0, 0);
  `, cell);
  console.log('+ a worker in Atomics.wait: %s ms', sharedGC().toFixed(1));
  Atomics.store(cell, 0, 1);
  Atomics.notify(cell, 0);

  // A worker blocked in a synchronous read of a FIFO, which another process
  // writes to after 2 seconds.
  const fifo = `/tmp/shared-gc-stall-${process.pid}`;
  execSync(`mkfifo ${fifo}`);
  const blocked = await startWorker(`
    const { parentPort, workerData } = require('node:worker_threads');
    parentPort.postMessage('ready');
    require('node:fs').readFileSync(workerData);
  `, fifo);
  spawn('sh', ['-c', `sleep 2; echo done > ${fifo}`], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log('+ a worker in readFileSync of a FIFO (written in ~1.8 s): %s ms',
              sharedGC().toFixed(1));
  // The read ends with the write; removing the FIFO before it would leave the
  // worker in open() for good.
  await once(blocked.worker, 'exit');
  execSync(`rm -f ${fifo}`);

  // A worker waiting for a child process in spawnSync.
  const spawning = await startWorker(`
    const { parentPort } = require('node:worker_threads');
    parentPort.postMessage('ready');
    require('node:child_process').spawnSync('sleep', ['2']);
  `);
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log('+ a worker in spawnSync of sleep 2: %s ms', sharedGC().toFixed(1));

  for (const { worker } of [...busy, parked, spawning]) {
    await worker.terminate();
  }
}

main();

// node bench-sync-parking.js
// What parking costs on the synchronous fs calls that the patched Node parks
// around: run it on Node with and without node/node.patch and compare. Each
// line is the median of 7 runs, in nanoseconds per call.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const file = path.join(os.tmpdir(), `bench-sync-parking-${process.pid}`);
fs.writeFileSync(file, 'x'.repeat(100));

const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
function bench(name, count, fn) {
  for (let i = 0; i < count / 10; i++) fn();
  const runs = [];
  for (let run = 0; run < 7; run++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < count; i++) fn();
    runs.push(Number(process.hrtime.bigint() - start) / count);
  }
  console.log('%s: %s ns', name.padEnd(28), median(runs).toFixed(0));
}

bench('fs.statSync', 200000, () => fs.statSync(file));
bench('fs.existsSync', 200000, () => fs.existsSync(file));
bench('fs.readFileSync utf8', 100000, () => fs.readFileSync(file, 'utf8'));
bench('fs.readFileSync buffer', 100000, () => fs.readFileSync(file));
const fd = fs.openSync(file, 'r');
const buffer = Buffer.alloc(100);
bench('fs.readSync', 300000, () => fs.readSync(fd, buffer, 0, 100, 0));
fs.closeSync(fd);
bench('spawnSync true', 300, () => spawnSync('true'));
fs.unlinkSync(file);

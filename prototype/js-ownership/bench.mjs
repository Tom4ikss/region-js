import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { Arena } from './arena.mjs';
import { TreeNode, buildTree, sumTree, buildPlainTree, sumPlainTree } from './model.mjs';

const DEPTH = 19;
const NODES = 2 ** (DEPTH + 1) - 1;
const WORKERS = Math.min(8, availableParallelism() - 1);
const RUNS = 5;
const REGION_BYTES = NODES * TreeNode.byteLength;

const arena = Arena.create(REGION_BYTES * (WORKERS + 1) + 1024 * 1024);
const workers = Array.from(
    { length: WORKERS },
    () => new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { buffer: arena.buffer } }),
);

function call(worker, message) {
    return new Promise((resolve, reject) => {
        worker.once('message', ({ value, error }) => (error ? reject(new Error(error)) : resolve(value)));
        worker.postMessage(message);
    });
}

async function fastest(fn) {
    let best = Infinity;
    for (let i = 0; i < RUNS; i++) {
        const start = performance.now();
        await fn();
        best = Math.min(best, performance.now() - start);
    }
    return best;
}

function expectSum(actual, expected) {
    if (actual !== expected) {
        throw new Error(`sum is ${actual}, expected ${expected}`);
    }
}

const ms = (value) => `${value.toFixed(3)} ms`;
const nodes = (count) => `${(count / 1e6).toFixed(1)}M nodes`;

console.log(`1) Transfer of a tree with ${nodes(NODES)} to a worker (round trip, best of ${RUNS})`);
const plainTree = buildPlainTree(DEPTH);
const region = arena.createRegion(REGION_BYTES);
const root = buildTree(region, DEPTH);
const [worker] = workers;

const cloneMs = await fastest(() => call(worker, { type: 'ack', tree: plainTree }));
let moveMs = Infinity;
for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    region.moveTo(worker.threadId);
    await call(worker, { type: 'take', regionId: region.id });
    moveMs = Math.min(moveMs, performance.now() - start);
    await call(worker, { type: 'giveBack', regionId: region.id });
}
console.log(`   structured clone: ${ms(cloneMs)}`);
console.log(`   region move:      ${ms(moveMs)}  (x${Math.round(cloneMs / moveMs)})`);

console.log('\n2) Ownership checks');
region.moveTo(worker.threadId);
await call(worker, { type: 'take', regionId: region.id });
try {
    root.value;
} catch (error) {
    console.log(`   main reads after move  -> ${error.name}: ${error.message}`);
}
await call(worker, { type: 'giveBack', regionId: region.id });
console.log(`   main reads after return -> root.value = ${root.value}`);
try {
    root.left = TreeNode.create(arena.createRegion(TreeNode.byteLength));
} catch (error) {
    console.log(`   cross-region reference -> ${error.name}: ${error.message}`);
}

console.log(`\n3) Sum of a tree with ${nodes(NODES)} on one thread (best of ${RUNS})`);
const plainSumMs = await fastest(() => expectSum(sumPlainTree(plainTree), NODES));
const regionSumMs = await fastest(() => expectSum(sumTree(root), NODES));
console.log(`   plain objects: ${ms(plainSumMs)}`);
console.log(`   region struct: ${ms(regionSumMs)}  (x${(regionSumMs / plainSumMs).toFixed(1)} slower)`);

console.log(`\n4) Sum of ${WORKERS} trees, ${nodes(NODES * WORKERS)} total (best of ${RUNS})`);
const regions = workers.map(() => arena.createRegion(REGION_BYTES));
const roots = regions.map((r) => buildTree(r, DEPTH));

const singleMs = await fastest(() => expectSum(roots.reduce((sum, r) => sum + sumTree(r), 0), NODES * WORKERS));
const parallelMs = await fastest(async () => {
    const sums = await Promise.all(
        workers.map((w, i) => {
            regions[i].moveTo(w.threadId);
            return call(w, { type: 'sumAndGiveBack', regionId: regions[i].id, root: roots[i].ptr });
        }),
    );
    expectSum(sums.reduce((a, b) => a + b, 0), NODES * WORKERS);
});
console.log(`   main thread: ${ms(singleMs)}`);
console.log(`   ${WORKERS} workers:   ${ms(parallelMs)}  (x${(singleMs / parallelMs).toFixed(1)})`);

await Promise.all(workers.map((w) => w.terminate()));

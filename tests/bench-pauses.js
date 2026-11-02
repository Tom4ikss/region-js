// d8 --harmony-regions bench-pauses.js
// Pauses that one thread's garbage causes in the others. The main thread and
// three workers count in a loop that allocates nothing and note every gap of a
// millisecond or more between two steps; a fifth thread makes garbage: plain
// objects, region objects created with 'use region', or plain objects copied
// into regions with region.run(). Every region is dropped right away. Garbage
// of a worker's own heap is collected by that worker alone, while region
// objects live in the shared heap, whose collection stops every thread.
// Modes run one after another in one process, so a shared heap left by one can
// be collected during the next: for clean numbers pass one mode per run,
// e.g. `d8 --harmony-regions bench-pauses.js -- local`.
const MODES = ['idle', 'local', 'use region', 'region.run'];
const SECONDS = 3;
const COUNTERS = 3;

// Counts until `stop` is set and returns the gaps of a millisecond or more.
const COUNTER_SOURCE = `(ctrl, stop) => {
  const gaps = new Float64Array(4096);
  let count = 0;
  let steps = 0;
  let x = 1;
  let last = performance.now();
  while (Atomics.load(ctrl, stop) === 0) {
    for (let k = 0; k < 10000; k++) x = (x * 1103515245 + 12345) | 0;
    const now = performance.now();
    if (now - last >= 1 && count < gaps.length) gaps[count++] = now - last;
    last = now;
    steps++;
  }
  return { steps, gaps: Array.from(gaps.subarray(0, count)), x };
}`;

// Makes garbage until `stop` is set; returns the number of objects made.
const CHURN_SOURCE = `(mode, ctrl, stop) => {
  const plainOrder = (i) => ({ id: i, customer: { name: 'c' + (i % 100) },
                              items: [{ qty: 1, price: 2 }, { qty: 2, price: 3 }] });
  const regionOrders = (from) => {
    'use region';
    using _ = new Region().enter();
    const orders = [];
    for (let i = from; i < from + 1000; i++) {
      orders.push({ id: i, customer: { name: 'c' + (i % 100) },
                    items: [{ qty: 1, price: 2 }, { qty: 2, price: 3 }] });
    }
    return orders;
  };
  let made = 0;
  // The last batch stays alive, so that it is really allocated.
  let keep = null;
  while (Atomics.load(ctrl, stop) === 0) {
    if (mode === 'idle') {
      Atomics.wait(ctrl, stop, 0, 5);
      continue;
    }
    if (mode === 'local') {
      const orders = [];
      for (let i = 0; i < 1000; i++) orders.push(plainOrder(made + i));
      keep = orders;
    } else if (mode === 'use region') {
      keep = regionOrders(made);
    } else {
      const orders = [];
      for (let i = 0; i < 1000; i++) orders.push(plainOrder(made + i));
      keep = new Region().run(() => orders);
    }
    made += 1000 * 5;  // five objects an order
  }
  return keep === null ? made : made + keep.length - keep.length;
}`;

const WORKER_SOURCE = `
  const count = ${COUNTER_SOURCE};
  const churn = ${CHURN_SOURCE};
  onmessage = ({ data }) => {
    const ctrl = new Int32Array(data.buffer);
    Atomics.add(ctrl, 0, 1);
    while (Atomics.load(ctrl, 1) === 0) {}
    postMessage(data.role === 'count' ? count(ctrl, 2) : churn(data.mode, ctrl, 2));
  };`;

const counters = Array.from({ length: COUNTERS },
                            () => new Worker(WORKER_SOURCE, { type: 'string' }));
const churner = new Worker(WORKER_SOURCE, { type: 'string' });

const run = (mode) => {
  const buffer = new SharedArrayBuffer(12);
  const ctrl = new Int32Array(buffer);
  for (const w of counters) w.postMessage({ role: 'count', buffer });
  churner.postMessage({ role: 'churn', mode, buffer });
  while (Atomics.load(ctrl, 0) < COUNTERS + 1) {}
  Atomics.store(ctrl, 1, 1);
  // The main thread counts too, for SECONDS, then stops everyone.
  const start = performance.now();
  let main;
  {
    const gaps = [];
    let steps = 0;
    let x = 1;
    let last = start;
    while (last - start < SECONDS * 1000) {
      for (let k = 0; k < 10000; k++) x = (x * 1103515245 + 12345) | 0;
      const now = performance.now();
      if (now - last >= 1) gaps.push(now - last);
      last = now;
      steps++;
    }
    main = { steps, gaps, x };
  }
  Atomics.store(ctrl, 2, 1);
  const workers = counters.map((w) => w.getMessage());
  const made = churner.getMessage();
  return { main, workers, made };
};

const describe = ({ gaps }) => {
  const total = gaps.reduce((a, b) => a + b, 0);
  const max = gaps.reduce((a, b) => Math.max(a, b), 0);
  const over5 = gaps.filter((g) => g >= 5).length;
  return `${String(gaps.length).padStart(3)} pauses, ${String(over5).padStart(3)} of 5+ ms, ` +
         `${total.toFixed(0).padStart(4)} ms in all, longest ${max.toFixed(1).padStart(5)} ms`;
};

const only = globalThis.arguments?.join(' ');
if (only && !MODES.includes(only)) throw new Error(`unknown mode: ${only}`);
run('idle');  // warm up
for (const mode of only ? [only] : MODES) {
  const { main, workers, made } = run(mode);
  const worst = workers.reduce((a, b) =>
    b.gaps.reduce((s, g) => s + g, 0) > a.gaps.reduce((s, g) => s + g, 0) ? b : a);
  print(`${mode}: garbage ${(made / SECONDS / 1e6).toFixed(1)} M objects/s`);
  print(`  main thread:  ${describe(main)}`);
  print(`  worst worker: ${describe(worst)}`);
}
for (const w of [...counters, churner]) w.terminate();

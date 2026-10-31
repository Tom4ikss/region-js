// d8 --harmony-region-literals --module --max-serializer-memory=4000 bench-real.js
// Three everyday workloads with orders, each three ways: spawn() with regions,
// plain workers with postMessage (what JS has today) and, in
// tests/tokio-bench (cargo run --release -- real), Rust with tokio.
// Four threads each. Prints the best and the median of five runs.
const THREADS = 4;
const ORDERS = 200_000;
const BATCHES = 200;
const PRODUCTS = 100_000;
const LOOKUPS = 1_000_000;
spawn.poolSize = THREADS;

const time = async (name, fn, reps = 5) => {
  const runs = [];
  let check;
  for (let i = 0; i < reps; i++) {
    const start = performance.now();
    check = await fn();
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  print(`${name}: ${runs[0].toFixed(1)} ms best, ${runs[reps >> 1].toFixed(1)} ms median (${check})`);
};

// The same order everywhere: a customer, three items, a total.
const ORDER_SOURCE = `(i) => ({
  id: i,
  customer: { name: 'customer ' + (i % 1000), city: i % 2 ? 'Moscow' : 'Kazan' },
  items: [
    { sku: 'sku ' + (i % 500), qty: 1 + (i % 3), price: 10 + (i % 7) },
    { sku: 'sku ' + ((i + 1) % 500), qty: 2, price: 20.5 },
    { sku: 'sku ' + ((i + 2) % 500), qty: 1, price: 5 + (i % 11) },
  ],
  total: 0,
})`;
const sumQty = (orders) => {
  let qty = 0;
  for (const order of orders) {
    for (const item of order.items) qty += item.qty;
  }
  return qty;
};

// Plain workers: one per thread, created once, answering requests.
const WORKER_SOURCE = `
  const makeOrder = ${ORDER_SOURCE};
  let catalog = null;
  onmessage = ({ data }) => {
    if (data.kind === 'build') {
      const orders = [];
      for (let i = data.from; i < data.to; i++) orders.push(makeOrder(i));
      postMessage(orders);
    } else if (data.kind === 'discount') {
      for (const order of data.batch) {
        let total = 0;
        for (const item of order.items) total += item.qty * item.price;
        order.total = total * 0.9;
      }
      postMessage(data.batch);
    } else if (data.kind === 'catalog') {
      catalog = data.catalog;
      let sum = 0;
      for (let i = 0; i < data.lookups; i++) {
        sum += catalog[(i * 7919 + data.seed) % catalog.length].price;
      }
      postMessage(sum);
    }
  };`;
const workers = Array.from({ length: THREADS },
                            () => new Worker(WORKER_SOURCE, { type: 'string' }));
// Start the spawn() pool.
await Promise.all(Array.from({ length: 64 }, (_, i) => spawn((i) => i, i)));

const slices = Array.from({ length: THREADS },
                          (_, t) => [t * ORDERS / THREADS, (t + 1) * ORDERS / THREADS]);

// 1. Build 200 000 orders on four threads and use them on the main thread.
await time('build: spawn + use region', async () => {
  const parts = await Promise.all(slices.map(([from, to]) => spawn((from, to, source) => {
    'use region';
    // The order literal of ORDER_SOURCE, as 'use region' code.
    const makeOrder = (0, eval)(`'use region'; ${source}`);
    using _ = new Region().enter();
    const orders = [];
    for (let i = from; i < to; i++) orders.push(makeOrder(i));
    return orders;  // moves to the caller, nothing is copied
  }, from, to, ORDER_SOURCE)));
  return parts.reduce((qty, part) => qty + sumQty(part), 0);
});
await time('build: workers + postMessage', () => {
  slices.forEach(([from, to], t) => workers[t].postMessage({ kind: 'build', from, to }));
  return workers.reduce((qty, worker) => qty + sumQty(worker.getMessage()), 0);
});

// 2. 200 batches of 1000 orders go to the threads, get a discount and come
// back.
const makeOrder = (0, eval)(ORDER_SOURCE);
const makeRegionOrder = (0, eval)(`'use region'; ${ORDER_SOURCE}`);
const makeBatch = (make, from, to) => {
  const orders = make === makeOrder ? [] : Region.array();
  for (let i = from; i < to; i++) orders.push(make(i));
  return orders;
};
const regionBatches = Array.from({ length: BATCHES }, (_, b) =>
  new Region().run(() => makeBatch(makeRegionOrder, b * 1000, (b + 1) * 1000)));
const plainBatches = Array.from({ length: BATCHES }, (_, b) =>
  makeBatch(makeOrder, b * 1000, (b + 1) * 1000));
const sumTotals = (batches) => {
  let sum = 0;
  for (const batch of batches) for (const order of batch) sum += order.total;
  return Math.round(sum);
};
await time('batches: spawn + regions', async () => {
  const done = await Promise.all(regionBatches.map((batch) => spawn((batch) => {
    for (const order of batch) {
      let total = 0;
      for (const item of order.items) total += item.qty * item.price;
      order.total = total * 0.9;
    }
    return batch;  // moves back
  }, batch)));
  return sumTotals(done);
});
await time('batches: workers + postMessage', () => {
  const done = [];
  for (let b = 0; b < BATCHES; b += THREADS) {
    for (let t = 0; t < THREADS; t++) {
      workers[t].postMessage({ kind: 'discount', batch: plainBatches[b + t] });
    }
    for (let t = 0; t < THREADS; t++) done.push(workers[t].getMessage());
  }
  return sumTotals(done);
});

// 3. A catalog of 100 000 products, read by four threads: a million lookups
// each. The time includes handing the catalog over.
const catalog = Array.from({ length: PRODUCTS },
                           (_, i) => ({ sku: 'sku ' + i, price: 1 + (i % 100), stock: i % 50 }));
await time('catalog: spawn + Region.share', async () => {
  const shared = Region.share(catalog);
  const sums = await Promise.all(Array.from({ length: THREADS }, (_, t) => spawn((catalog, seed, lookups) => {
    let sum = 0;
    for (let i = 0; i < lookups; i++) sum += catalog[(i * 7919 + seed) % catalog.length].price;
    return sum;
  }, shared, t, LOOKUPS)));
  return sums.reduce((a, b) => a + b);
});
await time('catalog: workers + postMessage', () => {
  workers.forEach((worker, t) => worker.postMessage({ kind: 'catalog', catalog, seed: t, lookups: LOOKUPS }));
  return workers.reduce((sum, worker) => sum + worker.getMessage(), 0);
});

for (const worker of workers) worker.terminate();

// d8-flags: --module
// Four spawn tasks build 100,000 orders. The objects are created directly in shared
// memory ('use region'), and the main thread receives them without a copy.
const ORDERS = 100_000;
const TASKS = 4;

const build = (from, to) => {
  'use region';
  using _ = new Region().enter();
  const orders = [];
  for (let i = from; i < to; i++) {
    orders.push({
      id: i,
      customer: { name: 'customer ' + (i % 1000) },
      items: [{ sku: 'sku ' + (i % 500), qty: 1 + (i % 3) }],
    });
  }
  return orders; // moves to the caller together with the region
};

let start = performance.now();
const parts = await Promise.all(Array.from({ length: TASKS }, (_, t) =>
  spawn(build, t * ORDERS / TASKS, (t + 1) * ORDERS / TASKS)));
const viaSpawn = performance.now() - start;
let qty = 0;
for (const part of parts) for (const order of part) qty += order.items[0].qty;
print(`spawn: ${parts.reduce((n, p) => n + p.length, 0)} orders, qty ${qty}, ${viaSpawn.toFixed(0)} ms`);
print('in a region:', Region.isRegionObject(parts[0][0]), '| owner is now the main thread:', Region.of(parts[0]).owner);

// The same with plain workers: postMessage copies every order back.
const workers = Array.from({ length: TASKS }, () => new Worker(`onmessage = ({ data: [from, to] }) => {
  const orders = [];
  for (let i = from; i < to; i++) {
    orders.push({ id: i, customer: { name: 'customer ' + (i % 1000) },
                  items: [{ sku: 'sku ' + (i % 500), qty: 1 + (i % 3) }] });
  }
  postMessage(orders);
}`, { type: 'string' }));
start = performance.now();
workers.forEach((w, t) => w.postMessage([t * ORDERS / TASKS, (t + 1) * ORDERS / TASKS]));
const copies = workers.map((w) => w.getMessage());
print(`postMessage: ${copies.reduce((n, p) => n + p.length, 0)} orders, ${(performance.now() - start).toFixed(0)} ms`);
for (const w of workers) w.terminate();

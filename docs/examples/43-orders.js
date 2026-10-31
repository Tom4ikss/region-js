// d8-flags: --module --harmony-region-literals
// Четыре задачи spawn собирают 100 000 заказов. Объекты создаются сразу в общей
// памяти ('use region'), и главный поток получает их без копии.
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
  return orders; // уезжает к вызывающему вместе с регионом
};

let start = performance.now();
const parts = await Promise.all(Array.from({ length: TASKS }, (_, t) =>
  spawn(build, t * ORDERS / TASKS, (t + 1) * ORDERS / TASKS)));
const viaSpawn = performance.now() - start;
let qty = 0;
for (const part of parts) for (const order of part) qty += order.items[0].qty;
print(`spawn: ${parts.reduce((n, p) => n + p.length, 0)} заказов, qty ${qty}, ${viaSpawn.toFixed(0)} мс`);
print('лежат в регионе:', Region.isRegionObject(parts[0][0]), '| владелец теперь главный поток:', Region.of(parts[0]).owner);

// То же на обычных воркерах: postMessage копирует каждый заказ обратно.
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
print(`postMessage: ${copies.reduce((n, p) => n + p.length, 0)} заказов, ${(performance.now() - start).toFixed(0)} мс`);
for (const w of workers) w.terminate();

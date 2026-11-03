// 'use region': in the function, and in the functions inside it, every {} is #{} and [] is #[].
// Plain JS syntax: TypeScript, ESLint and Biome understand it.
const region = new Region();

function buildOrder(rows) {
  'use region';
  using _ = region.enter();
  const order = { id: 7, customer: { name: 'Ann' }, items: [] };
  for (const row of rows) {
    order.items.push({ sku: row.sku, qty: row.qty, tags: [row.kind] });
  }
  const { customer: { name } } = order; // destructuring stays ordinary
  return { order, total: order.items.length, name };
}

const result = buildOrder([
  { sku: 'apple', qty: 3, kind: 'fruit' },
  { sku: 'milk', qty: 1, kind: 'dairy' },
]);
print('in the region:', Region.isRegionObject(result), Region.isRegionObject(result.order.items[1].tags));
print(JSON.stringify(result));

// Whatever #{} cannot do is a syntax error.
try {
  new Function(`'use region'; return { ...other };`);
} catch (e) {
  print(e.name + ':', e.message);
}

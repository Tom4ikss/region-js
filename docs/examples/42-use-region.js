// d8-flags: --harmony-region-literals
// 'use region': в функции, и в функциях внутри неё, каждый {} — это #{}, а [] — #[].
// Обычный JS-синтаксис: TypeScript, ESLint и Biome его понимают.
const region = new Region();

function buildOrder(rows) {
  'use region';
  using _ = region.enter();
  const order = { id: 7, customer: { name: 'Ann' }, items: [] };
  for (const row of rows) {
    order.items.push({ sku: row.sku, qty: row.qty, tags: [row.kind] });
  }
  const { customer: { name } } = order; // деструктуризация остаётся обычной
  return { order, total: order.items.length, name };
}

const result = buildOrder([
  { sku: 'apple', qty: 3, kind: 'fruit' },
  { sku: 'milk', qty: 1, kind: 'dairy' },
]);
print('в регионе:', Region.isRegionObject(result), Region.isRegionObject(result.order.items[1].tags));
print(JSON.stringify(result));

// То, чего не умеет #{}, — синтаксическая ошибка.
try {
  new Function(`'use region'; return { ...other };`);
} catch (e) {
  print(e.name + ':', e.message);
}

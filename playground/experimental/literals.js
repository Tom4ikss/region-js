// #{ } and #[ ] create objects straight in the current region, no copy.
// Run with Cmd+Shift+B (the task passes --harmony-region-literals).
// Editor tools do not know this syntax yet: TypeScript shows a syntax error
// here, Biome and ESLint skip this folder.
const region = new Region();
let shop;
{
  using _ = region.enter();
  shop = #{ orders: #[], total: 0, currency: 'EUR' };
  for (let id = 1; id <= 3; id++) {
    shop.orders.push(#{ id, price: id * 10, tags: #['new'] });
    shop.total += id * 10;
  }
}
print(JSON.stringify(shop));
print('all in one region:', Region.of(shop.orders[2]).id === region.id);

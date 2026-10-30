// d8-flags: --module --harmony-region-literals
// Литералы #{} и #[]: объект или массив создаётся сразу в текущем регионе, без копии.
const region = new Region();
let shop;
{
  using _ = region.enter();
  const currency = 'EUR';
  shop = #{ currency, 'opened-at': 9, total: 0, orders: #[] };
  for (let id = 1; id <= 3; id++) {
    shop.orders.push(#{ id, price: id * 10, tags: #['новый'] });
    shop.total += id * 10;
  }
}
print('в регионе:', Region.of(shop.orders[2].tags).id === region.id, '| сумма:', shop.total);
print(JSON.stringify(shop.orders[0]));

// Внутри run() регион тоже текущий.
const point = region.run(() => #{ x: 1, y: 2 });
print('из run:', Region.of(point).id === region.id);

const tryIt = (label, fn) => {
  try {
    fn();
    print(`${label}: работает`);
  } catch (e) {
    print(`${label}: ${e.name}: ${e.message}`);
  }
};
tryIt('без текущего региона', () => #{ a: 1 });
{
  using _ = region.enter();
  tryIt('#{} внутри #{}', () => #{ nested: #{ a: 1 } });
  tryIt('обычный объект внутри', () => #{ nested: { a: 1 } });
}

// В задаче spawn текущего региона нет: входят в регион, который приехал с данными.
const count = await spawn(() => {
  using _ = Region.of(shop).enter();
  shop.orders.push(#{ id: 4, price: 40, tags: #[] });
  return shop.orders.length;
});
print('после задачи:', count, '| последний заказ:', JSON.stringify(shop.orders[3]));

// Spread, вычисляемые ключи, методы и дырки — синтаксическая ошибка.
for (const source of ['#{ ...x }', '#{ [key]: 1 }', '#{ total() {} }', '#[1, , 3]']) {
  tryIt(source, () => new Function(source));
}

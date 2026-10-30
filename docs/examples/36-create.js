// d8-flags: --harmony-region-literals
// Сколько стоит положить данные в регион: 200 000 товаров { id, name, tags, price }.
// Пять способов собрать один и тот же массив, и после каждого — проход по нему.
const N = 200_000;
const item = (i) => ({ id: i, name: 'товар ' + i, tags: ['новый', 'склад'], price: i % 100 });

// 1. Обычные объекты, без регионов.
const plain = () => Array.from({ length: N }, (_, i) => item(i));

// 2. Собрать обычные объекты и скопировать в регион через run.
const viaRun = (region) => region.run(plain);

// 3. Каждый объект сразу в регион через Region.object, в конце один массив.
const viaObject = (region) => {
  using _ = region.enter();
  const list = new Array(N);
  for (let i = 0; i < N; i++) {
    list[i] = Region.object({ id: i, name: 'товар ' + i, tags: Region.array('новый', 'склад'), price: i % 100 });
  }
  return Region.object({ list }).list; // копируется только внешний массив
};

// 4. То же, но массив региона растёт через push.
const viaPush = (region) => {
  using _ = region.enter();
  const list = Region.array();
  for (let i = 0; i < N; i++) {
    list.push(Region.object({ id: i, name: 'товар ' + i, tags: Region.array('новый', 'склад'), price: i % 100 }));
  }
  return list;
};

// 5. Литерал #{} создаёт объект сразу в регионе, без копии; массив растёт через push.
const viaLiteral = (region) => {
  using _ = region.enter();
  const list = #[];
  for (let i = 0; i < N; i++) {
    list.push(#{ id: i, name: 'товар ' + i, tags: #['новый', 'склад'], price: i % 100 });
  }
  return list;
};

// Каждому способу своя копия функции прохода, чтобы подсказки inline cache не смешивались.
let copies = 0;
const makeSum = () => new Function('list', `// копия ${++copies}
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].price;
  return total;
`);

const measure = (label, build) => {
  const sumPrices = makeSum();
  let buildMs = Infinity, readMs = Infinity, total = 0;
  for (let rep = 0; rep < 3; rep++) {
    const region = new Region();
    let t = performance.now();
    const list = build(region);
    buildMs = Math.min(buildMs, performance.now() - t);
    t = performance.now();
    total = sumPrices(list);
    readMs = Math.min(readMs, performance.now() - t);
  }
  print(`${label}: создание ${buildMs.toFixed(0)} ms, проход ${readMs.toFixed(1)} ms (сумма ${total})`);
};

measure('обычные объекты        ', () => plain());
measure('region.run             ', viaRun);
measure('Region.object, enter   ', viaObject);
measure('Region.object и push   ', viaPush);
measure('литерал #{} и push     ', viaLiteral);

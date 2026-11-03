// The cost of putting data into a region: 200,000 products { id, name, tags, price }.
// Four ways to build the same array, and a pass over it after each one.
const N = 200_000;
const item = (i) => ({ id: i, name: 'item ' + i, tags: ['new', 'in stock'], price: i % 100 });

// 1. Plain objects, no regions.
const plain = () => Array.from({ length: N }, (_, i) => item(i));

// 2. Build plain objects and copy them into a region with run.
const viaRun = (region) => region.run(plain);

// 3. One at a time: each object is copied into the region by its own run, the region array grows with push.
const viaRunEach = (region) => {
  const list = region.run(() => []);
  for (let i = 0; i < N; i++) list.push(region.run(() => item(i)));
  return list;
};

// 4. The #{} literal creates the object directly in the region, without a copy; the array grows with push.
const viaLiteral = (region) => {
  using _ = region.enter();
  const list = #[];
  for (let i = 0; i < N; i++) {
    list.push(#{ id: i, name: 'item ' + i, tags: #['new', 'in stock'], price: i % 100 });
  }
  return list;
};

// Each way gets its own copy of the pass function, so that inline cache feedback does not mix.
let copies = 0;
const makeSum = () => new Function('list', `// copy ${++copies}
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
  print(`${label}: build ${buildMs.toFixed(0)} ms, pass ${readMs.toFixed(1)} ms (sum ${total})`);
};

measure('plain objects        ', () => plain());
measure('one region.run       ', viaRun);
measure('run per item and push', viaRunEach);
measure('#{} literal and push ', viaLiteral);

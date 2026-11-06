// node --harmony-regions query.js [rows]: query() of server.js over a plain
// catalog and over a sealed one (Region.share), without HTTP: on this
// thread and in a spawn() task. On this thread the plain catalog gets slower
// after the sealed one: query() has seen both kinds of objects.
'use strict';
const { buildCatalog, query } = require('./work');
const rows = Number(process.argv[2] ?? 1e6);
const plain = buildCatalog(rows);
const sealed = Region.share(buildCatalog(rows));

function time(catalog, n) {
  let x = 0;
  const start = performance.now();
  for (let i = 0; i < n; i++) x += query(catalog, i).inStock;
  return ((performance.now() - start) * 1000 / n).toFixed(1) + ' us';
}

async function main() {
  for (let round = 0; round < 3; round++) {
    console.log('main  plain %s  sealed %s', time(plain, 4000), time(sealed, 4000));
  }
  const inTask = (catalog) => {
    const out = [];
    for (let round = 0; round < 3; round++) {
      let x = 0;
      const start = performance.now();
      for (let i = 0; i < 4000; i++) x += query(catalog, i).inStock;
      out.push(((performance.now() - start) * 1000 / 4000).toFixed(1) + ' us');
    }
    return out.join(' ');
  };
  console.log('task  sealed %s', await spawn(inTask, sealed));
  // A plain catalog built inside the task, for the same thread.
  console.log('task  plain  %s', await spawn((rows) => {
    const catalog = buildCatalog(rows);
    const out = [];
    for (let round = 0; round < 3; round++) {
      let x = 0;
      const start = performance.now();
      for (let i = 0; i < 4000; i++) x += query(catalog, i).inStock;
      out.push(((performance.now() - start) * 1000 / 4000).toFixed(1) + ' us');
    }
    return out.join(' ');
  }, rows));
}
main();

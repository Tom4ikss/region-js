// d8 --harmony-regions --allow-natives-syntax --expose-gc --region-gc-pages=8 region-strings.js
// Strings and numbers that a region shares are copied into the memory of the
// region, on its pages or chunks, and die with it: they no longer wait for a
// shared GC. %RegionOfValue tells the region whose memory holds a value.
// A string of one region stored into another is copied again, so that no
// region points into another, and keys of shapes are common copies, since
// shapes outlive regions. A string that is still alive keeps its region from
// being collected: by its owner, which then marks the region, or by another
// isolate, which holds the region until it lets go of the string. When the
// id of a dead region is released, what is left of it, such as a string,
// becomes common, as do strings of chunks after a shared GC, which may move
// them. --no-region-strings turns this off. While the shared heap is being
// marked owners mark nothing, so the checks fail under
// --stress-incremental-marking.
// skip-variants: stress-gc
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const sleep = (() => {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  return (ms) => Atomics.wait(cell, 0, 0, ms);
})();
const waitFor = (fn) => {
  for (let i = 0; i < 500; i++) {
    if (fn()) return true;
    sleep(10);
  }
  return false;
};

const TABLE = `
  function table(region, count, prefix) {
    'use region';
    using _ = region.enter();
    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push({ id: i, name: prefix + i, price: i + 0.5 });
    }
    return rows;
  }`;

const owner = new Worker(TABLE + `
  function wrap(region, value) {
    'use region';
    using _ = region.enter();
    return { value };
  }
  let kept = null;
  let name = null;
  let price = null;
  let id = -1;
  onmessage = ({ data }) => {
    if (data.op === 'own') {
      const result = [];
      for (const count of [10, 5000]) {
        const region = new Region();
        const row = table(region, count, 'r')[count - 1];
        result.push(%RegionOfValue(row.name) === region.id &&
                    %RegionOfValue(row.price) === region.id &&
                    row.name === 'r' + (count - 1) &&
                    row.price === count - 0.5);
      }
      postMessage(result);
    } else if (data.op === 'cross') {
      const a = new Region();
      const b = new Region();
      const rowsA = table(a, 10, 'a');
      const rowsB = table(b, 10, 'b');
      rowsB[0].name = rowsA[3].name;
      rowsB[0].price = rowsA[3].price;
      const wrapped = wrap(b, rowsA[4].name);
      const copied = b.run(() => ({ [rowsA[5].name]: rowsA[5].name }));
      const key = Object.keys(copied)[0];
      postMessage([
        %RegionOfValue(rowsB[0].name) === b.id && rowsB[0].name === 'a3' &&
            %RegionOfValue(rowsB[0].price) === b.id && rowsB[0].price === 3.5,
        %RegionOfValue(wrapped.value) === b.id && wrapped.value === 'a4',
        %RegionOfValue(copied.a5) === b.id && key === 'a5' &&
            %RegionOfValue(key) === -1,
        %RegionOfValue(rowsB[1].name) === b.id,
      ]);
    } else if (data.op === 'mark') {
      // Keeps one string and one number of a big region; churns another to
      // get the region GC.
      const region = new Region();
      const rows = table(region, 30000, 'm');
      name = rows[4321].name;
      price = rows[4321].price;
      id = region.id;
      const marked = %RegionMarkedCount();
      for (let i = 0; i < 4; i++) table(new Region(), 30000, 'x');
      postMessage([%RegionMarkedCount() > marked, %RegionOfValue(name) === id,
                   name === 'm4321', price === 4321.5]);
    } else if (data.op === 'detach') {
      // A string outlives every object of its region. It is one of the last rows,
// on a page of the region: a shared GC makes strings in chunks common.
      const region = new Region();
      name = table(region, 30000, 'd')[29777].name;
      id = region.id;
      gc();
      postMessage(%RegionOfValue(name) === id);
    } else if (data.op === 'gc') {
      gc();
      gc();
      postMessage(null);
    } else if (data.op === 'after-detach') {
      for (let i = 0; i < 20; i++) table(new Region(), 3000, 'y');
      gc();
      postMessage([%RegionOfValue(name), name === 'd29777']);
    } else if (data.op === 'freeze') {
      const region = new Region();
      kept = table(region, 30000, 'f');
      id = region.id;
      region.freeze();
      postMessage({ rows: kept, id });
    } else if (data.op === 'thaw') {
      Region.of(kept).thaw();
      postMessage(null);
    } else if (data.op === 'drop') {
      kept = null;
      gc();
      gc();
      postMessage(null);
    } else if (data.op === 'state') {
      postMessage([%RegionPageCount(id), %RegionHolderCount(id)]);
    }
  };`, { type: 'string' });

const reader = new Worker(`
  let name = null;
  onmessage = ({ data }) => {
    if (data.op === 'read') {
      using _ = Region.of(data.rows).borrow();
      name = data.rows[29005].name;
      postMessage(%RegionOfValue(name) === data.id);
    } else if (data.op === 'moved') {
      postMessage(%RegionOfValue(name) !== data.id);
    } else if (data.op === 'check') {
      gc();
      postMessage(name === 'f29005' &&
                  (%RegionIsHolder(data.id) || %RegionOfValue(name) !== data.id));
    } else if (data.op === 'drop') {
      name = null;
      gc();
      gc();
      postMessage(null);
    }
  };`, { type: 'string' });

const ask = (worker, message) => {
  worker.postMessage(message);
  return worker.getMessage();
};

check('strings and numbers in the memory of their region',
      ask(owner, { op: 'own' }).every((ok) => ok));

const [storeCopied, literalCopied, runCopied, ownKept] =
    ask(owner, { op: 'cross' });
check('a string of another region copied on store', storeCopied);
check('copied into a literal of another region', literalCopied);
check('copied by region.run(), with a common key', runCopied);
check('strings of the region itself stay', ownKept);

const [marked, markedOwn, markedName, markedPrice] = ask(owner, { op: 'mark' });
check('a region with one live string is marked', marked);
check('the string and the number stay in it', markedOwn && markedName &&
      markedPrice);

// The id of the region goes once a shared GC finds none of its objects; the
// main thread drives the shared GC.
check('a string outlives the objects of its region', ask(owner, { op: 'detach' }));
ask(owner, { op: 'gc' });
gc();
gc();
const [detachedRegion, detachedName] = ask(owner, { op: 'after-detach' });
check('its memory becomes common once the id goes', detachedRegion === -1);
check('the string intact', detachedName);

// Another isolate holds a string of a frozen region it read. The main thread
// passes the region on and lets go of it.
const id = (() => {
  const { rows, id } = ask(owner, { op: 'freeze' });
  check('the reader gets a string of the region',
        ask(reader, { op: 'read', rows, id }));
  return id;
})();
// A report counts pointers of objects that die in the same GC, hence two.
gc();
gc();
ask(owner, { op: 'thaw' });
ask(owner, { op: 'drop' });
sleep(300);
// Under heavy GC (--stress-concurrent-allocation) the string can become
// common memory meanwhile; then the reader holds nothing of the region, and
// the owner collects it at once. The state is read first, so a string that
// moves later still counts as held.
const pages = ask(owner, { op: 'state' })[0];
check('not collected while the reader holds the string',
      pages > 0 || ask(reader, { op: 'moved', id }));
check('the string intact at the reader, which holds the region',
      ask(reader, { op: 'check', id }));
ask(reader, { op: 'drop' });
check('collected once the reader lets go',
      waitFor(() => ask(owner, { op: 'state' })[0] === 0));

owner.terminate();
reader.terminate();
print('done');

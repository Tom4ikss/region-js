// d8 --harmony-region-literals --allow-natives-syntax --expose-gc --verify-heap region-holders.js
// Every region knows which isolates may hold pointers to its objects. An
// isolate is added before it can get one: it creates or claims the region,
// borrows it, or receives its objects in a message. Only its own full GC takes
// it out, once it finds no pointer left; a move never does, because the old
// owner may still have raw pointers. The report comes at the start of the GC,
// so a pointer that died since the previous one still counts. %RegionHolderCount
// and %RegionIsHolder show the set.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const holders = (region) => %RegionHolderCount(region.id);
const isHolder = (region) => %RegionIsHolder(region.id);

function build(region, n) {
  'use region';
  using _ = region.enter();
  const list = [];
  for (let i = 0; i < n; i++) list.push({ i, tags: ['t' + (i % 3)] });
  return { list };
}

// The creator holds the region, and keeps holding it while it owns it, even
// with no pointer left: an owner can allocate new ones.
const own = new Region();
build(own, 10);
gc();
check('owner without pointers stays', holders(own) === 1 && isHolder(own));

const worker = new Worker(`
  const holders = (region) => %RegionHolderCount(region.id);
  const isHolder = (region) => %RegionIsHolder(region.id);
  let kept = null;
  onmessage = ({ data }) => {
    if (data.op === 'take') {
      kept = data.value;
      const region = Region.of(kept);
      postMessage([isHolder(region), holders(region)]);
    } else if (data.op === 'give back') {
      const value = kept;
      kept = null;
      postMessage({ value }, [Region.of(value)]);
    } else if (data.op === 'collect') {
      // The report comes at the start of a full GC, so pointers that died
      // since the last one still count: the second GC sees them gone.
      gc();
      gc();
      postMessage(%RegionHolderCount(data.id));
    }
  };`, { type: 'string' });

// A move adds the new owner; the old one stays until its own GC finds no
// pointer to the region.
const moved = new Region();
let value = build(moved, 1000);
worker.postMessage({ op: 'take', value }, [moved]);
const [workerHolds, countAfterMove] = worker.getMessage();
check('receiver added', workerHolds && countAfterMove === 2);
gc();
check('sender with pointers stays', isHolder(moved) && holders(moved) === 2);
value = null;
gc();
gc();
check('sender without pointers leaves', !isHolder(moved) && holders(moved) === 1);

// Back to the main thread: the worker stays until its GC.
worker.postMessage({ op: 'give back' });
const back = worker.getMessage().value;
check('main is a holder again', isHolder(moved) && holders(moved) === 2);
worker.postMessage({ op: 'collect', id: moved.id });
check('worker leaves after its GC', worker.getMessage() === 1);
check('data intact', back.list.length === 1000 && back.list[999].tags[0] === 't0');

// Readers of a frozen region are holders while they keep pointers.
const shared = new Region();
const config = shared.run(() => ({ name: 'prod', limits: [1, 2, 3] }));
shared.freeze();
const reader = new Worker(`
  let kept = null;
  onmessage = ({ data }) => {
    if (data.op === 'read') {
      using _ = Region.of(data.config).borrow();
      kept = data.config;
      postMessage([%RegionIsHolder(Region.of(kept).id), kept.limits[2]]);
    } else {
      kept = null;
      gc();
      gc();
      postMessage(%RegionHolderCount(data.id));
    }
  };`, { type: 'string' });
reader.postMessage({ op: 'read', config });
check('reader added', reader.getMessage().join() === 'true,3');
reader.postMessage({ op: 'drop', id: shared.id });
check('reader leaves after its GC', reader.getMessage() === 1);

worker.terminate();
reader.terminate();
print('done');

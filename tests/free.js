// d8 --harmony-regions --module --expose-gc --verify-heap free.js
// region.free(): nobody may touch the region again, its typed array memory
// goes at once, and its objects are emptied at the next shared GC.
const expectError = (name, fn) => {
  try {
    print(`${name}: NO ERROR ->`, fn());
  } catch (e) {
    print(`${name}:`, e.message);
  }
};

// The owner frees; every later access fails, also from hot code.
{
  const region = new Region();
  const tree = region.run(() => ({ name: 'tree', nodes: Array.from({ length: 1000 }, (_, i) => ({ i })) }));
  const read = (t) => t.nodes.length;
  let sum = 0;
  for (let i = 0; i < 100000; i++) sum += read(tree);
  print('byteSize before:', region.byteSize > 1000 * 16, 'hot reads:', sum);
  region.free();
  print('freed:', region.freed, 'byteSize after:', region.byteSize);
  expectError('read after free', () => tree.name);
  expectError('hot read after free', () => read(tree));
  expectError('write after free', () => { tree.name = 'x'; });
  expectError('free twice', () => region.free());
  expectError('freeze after free', () => region.freeze());
  expectError('Object.keys after free', () => Object.keys(tree));
}

// Typed array memory is released right away; the owner's view is detached.
{
  const region = new Region();
  const big = region.run(() => ({ samples: new Float64Array(1 << 20) }));
  const view = big.samples;
  print('typed array bytes:', region.byteSize >= 8 << 20, 'view length:', view.length);
  region.free();
  print('view after free:', view.length);
}

// `using` frees at the end of the block, unless the region moved away.
let escaped;
{
  using region = new Region();
  escaped = region.run(() => ({ temp: true }));
}
expectError('after using block', () => escaped.temp);
{
  using region = new Region();
  const data = region.run(() => ({ n: 1 }));
  const w = new Worker('onmessage = ({ data }) => postMessage(data.n + 1);', { type: 'string' });
  w.postMessage(data, [region]);
  print('moved before the block ended, worker got:', w.getMessage());
  w.terminate();
}
print('using with a moved region: no error');

// A frozen region: only its freezer frees it, and only without borrows.
{
  const region = new Region();
  const config = region.run(() => ({ name: 'prod' }));
  region.freeze();
  const borrow = region.borrow();
  expectError('free while borrowed', () => region.free());
  borrow.release();
  const reader = spawn(() => config.name);
  print('task read before free:', await reader);
  region.free();
  expectError('task read after free', () => spawn(() => config.name).join());
}

// A task may free a region it was given; nothing comes back then.
{
  const state = new Region().run(() => ({ big: new Uint8Array(1024) }));
  await spawn(() => {
    Region.of(state).free();
  });
  expectError('main after the task freed it', () => state.big);
}

// Not ours, or in flight: cannot be freed.
{
  const region = new Region();
  const data = region.run(() => ({ n: 1 }));
  const task = spawn(() => {
    const t = Date.now();
    while (Date.now() - t < 50) {}
    return data.n;
  });
  expectError('free while a task has it', () => region.free());
  print('task result:', await task);
}

// Freed objects let go of their contents at the next shared GC even if JS
// still refers to them; the id is reused once they are gone.
{
  gc();
  gc();
  const before = Region.stats();
  const husks = [];
  for (let i = 0; i < 20; i++) {
    const region = new Region();
    husks.push(region.run(() => ({ payload: 'x'.repeat(10000) + i })));
    region.free();
  }
  gc();
  gc();
  const kept = Region.stats();
  husks.length = 0;
  gc();
  gc();
  const after = Region.stats();
  print('freed regions while referenced:', kept.freed - before.freed >= 20,
        'released after the references are gone:', after.freed - before.freed < 20);
}
print('stats:', JSON.stringify(Object.keys(Region.stats())));

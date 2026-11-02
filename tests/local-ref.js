// d8 --harmony-regions --module --expose-gc --verify-heap local-ref.js
// Region.localRef(obj): a handle to an object of this thread that region
// objects can hold. Every thread reads it as a LocalRef of its own; only the
// thread that made it can deref() it, like SendWrapper in Rust.
const expectError = (name, fn) => {
  try {
    fn();
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}${e.reason ? ` [${e.reason}]` : ''}`);
  }
};
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

expectError('primitive', () => Region.localRef(1));
expectError('nothing', () => Region.localRef());
expectError('region object', () => Region.localRef(new Region().run(() => ({}))));
expectError('constructor', () => new LocalRef());
expectError('deref on a plain object', () => LocalRef.prototype.deref.call({}));

// Here: the object itself.
const widget = { name: 'widget', clicks: 0, cache: new Map([[1, 'one']]) };
const ref = Region.localRef(widget);
print('basic:', ref instanceof LocalRef, ref.local, ref.deref() === widget,
      Object.keys(ref).length, String(ref));

// Kept in a region: through run, literals and property sets.
const region = new Region();
const state = region.run(() => ({ ui: ref, list: [ref, Region.localRef(globalThis)], other: null }));
state.other = ref;
print('identity:', state.ui === ref, state.list[0] === ref, state.other === ref,
      state.list[1].deref() === globalThis);
state.ui.deref().clicks++;
print('deref:', widget.clicks, state.ui.deref().cache.get(1));
print('includes:', state.list.includes(ref), state.list.indexOf(ref),
      state.list.indexOf(Region.localRef(widget)));
state.other = ref;
print('stored again:', state.other === ref);

// In a task: the region moves there, the object stays here.
{
  const seen = await spawn(() => {
    const result = [state.ui.local, state.ui === state.list[0], typeof state.ui.deref];
    try {
      state.ui.deref();
    } catch (e) {
      result.push(e.name, e.reason, e.message.replace(/isolate \d+/g, 'isolate N'));
    }
    return result.join(' | ');
  });
  print('task:', seen);
  print('back here:', state.ui.deref() === widget, state.ui === ref);
}

// Straight into a task: arguments and captures travel in a region.
print('spawn argument:', await spawn((r) => `${r.local} ${r instanceof LocalRef}`, ref),
      await spawn(() => ref.local));
// A copy would refer to nothing.
{
  const w = new Worker('onmessage = () => {};', { type: 'string' });
  expectError('postMessage', () => w.postMessage(ref));
  expectError('postMessage nested', () => w.postMessage({ list: [ref] }));
  w.terminate();
}

// A worker and a channel.
{
  const box = new Region().run(() => ({ ref }));
  const w = new Worker(`
    onmessage = ({ data }) => {
      let message;
      try { data.ref.deref(); message = 'no error'; } catch (e) { message = e.reason; }
      postMessage([data.ref.local, data.ref instanceof LocalRef, message].join(' '));
      postMessage(data, [data]);
    };`, { type: 'string' });
  w.postMessage(box, [box]);
  print('worker:', w.getMessage());
  const back = w.getMessage();
  print('worker back:', back.ref === ref, back.ref.deref() === widget);
  w.terminate();

  const ch = new Channel(1);
  await ch.send(new Region().run(() => ({ ref })));
  const got = (await ch.recv()).value;
  print('channel:', got.ref === ref);
}

// A region keeps the object alive; nothing else refers to it.
{
  const kept = new Region().run(() => ({ ref: Region.localRef({ label: 'only in a region' }) }));
  await turn();
  for (let i = 0; i < 4; i++) gc();
  print('kept by a region:', kept.ref.deref().label);
}

// Dropped when nothing refers to the ref.
{
  let target = { label: 'temporary' };
  const weak = new WeakRef(target);
  let temporary = Region.localRef(target);
  target = null;
  temporary = null;
  for (let i = 0; i < 3; i++) {
    await turn();
    gc();
    gc();
  }
  print('dropped without refs:', weak.deref() === undefined);
}

// And when the region that held the ref is freed.
{
  const area = new Region();
  let target = { label: 'freed with its region' };
  const weak = new WeakRef(target);
  const husk = area.run(() => ({ ref: Region.localRef(target) }));
  target = null;
  for (let i = 0; i < 2; i++) {
    await turn();
    gc();
  }
  print('alive while the region is:', weak.deref() !== undefined);
  area.free();
  for (let i = 0; i < 3; i++) {
    await turn();
    gc();
    gc();
  }
  print('dropped with the region:', weak.deref() === undefined, Region.isRegionObject(husk));
}

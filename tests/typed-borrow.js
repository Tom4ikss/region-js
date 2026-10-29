// d8 --harmony-regions --module typed-borrow.js
// A typed array view reads raw region memory, so it exists only while the
// thread may read: the thread that froze the region, or one borrowing it.
const expectError = (name, fn) => {
  try {
    print(`${name}: NO ERROR ->`, fn());
  } catch (e) {
    print(`${name}:`, e.message);
  }
};

// A plain worker needs a borrow; the view is detached when it ends.
{
  const region = new Region();
  const s = region.run(() => ({ name: 'frozen', data: new Int32Array([1, 2, 3]) }));
  region.freeze();
  const w = new Worker(`
    let view;
    onmessage = ({ data }) => {
      if (data.cmd === 'plain') {
        let out;
        try { view = data.s.data; out = 'NO ERROR'; } catch (e) { out = e.message; }
        postMessage('field: ' + data.s.name + '; typed array without borrow: ' + out);
      } else if (data.cmd === 'borrow') {
        const borrow = Region.of(data.s).borrow();
        view = data.s.data;
        const before = view[0];
        borrow.release();
        postMessage('under borrow: ' + before + '; after release: length ' + view.length);
      } else {
        postMessage('later: length ' + view.length + ', [0] = ' + view[0]);
      }
    };`, { type: 'string' });
  w.postMessage({ cmd: 'plain', s });
  print(w.getMessage());
  w.postMessage({ cmd: 'borrow', s });
  print(w.getMessage());

  // The thread that froze it reads without borrowing; thaw detaches that view.
  const frozenView = s.data;
  print('freezer reads:', frozenView[1]);
  region.thaw();
  print('freezer view after thaw: length', frozenView.length);
  s.data[0] = 100;
  print('owner writes again:', s.data[0]);

  const w2 = new Worker(
    `onmessage = ({ data }) => { data.s.data[0] = 555; postMessage('w2 wrote'); }`,
    { type: 'string' });
  w2.postMessage({ s }, [region]);
  print(w2.getMessage());
  w.postMessage({ cmd: 'later' });
  print('old worker view while w2 owns:', w.getMessage());
  w.terminate();
  w2.terminate();
}

// Handing over the right to thaw detaches the sender's views.
{
  const region = new Region();
  const s = region.run(() => ({ data: new Float64Array([0.5]) }));
  region.freeze();
  const view = s.data;
  const w = new Worker(`onmessage = ({ data }) => postMessage(Region.of(data.s).frozenHere);`,
                       { type: 'string' });
  w.postMessage({ s }, [region]);
  print('receiver may thaw:', w.getMessage(), 'sender view: length', view.length);
  expectError('sender reads without borrow', () => s.data[0]);
  {
    using borrow = region.borrow();
    print('sender under borrow:', s.data[0]);
  }
  w.terminate();
}

// A spawn() task borrows the frozen regions it gets for its whole run.
{
  // One pool worker, so the later task runs where the view was stashed.
  spawn.poolSize = 1;
  const state = new Region().run(() => ({ data: new Uint8Array([7, 8, 9]) }));
  Region.of(state).freeze();
  print('task reads:', await spawn(() => state.data[2]));
  const kept = await spawn(() => {
    globalThis.stash = state.data;
    return globalThis.stash.length;
  });
  const later = await spawn(() => (globalThis.stash ? globalThis.stash.length : 'other worker'));
  print('stashed view in task:', kept, 'in a later task:', later);
  print('readers after tasks:', Region.of(state).readers);
  Region.of(state).thaw();
  print('thawed:', !Region.of(state).frozen);
}

// borrowWhile works the same way on main.
{
  const region = new Region();
  const s = region.run(() => ({ data: new Int16Array([4, 5]) }));
  region.freeze();
  const w = new Worker(`onmessage = async ({ data }) => {
      const sum = await Region.of(data.s).borrowWhile(async () => {
        await Promise.resolve();
        return data.s.data[0] + data.s.data[1];
      });
      postMessage('worker borrowWhile: ' + sum);
    };`, { type: 'string' });
  w.postMessage({ s });
  print(w.getMessage());
  region.thaw();
  w.terminate();
}

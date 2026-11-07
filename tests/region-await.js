// d8 --harmony-regions --expose-gc --verify-heap region-await.js
// region.run(fn): the region stays current in what fn continues as, after
// its awaits and in the promise callbacks it adds, so 'use region' code
// there keeps creating its objects in the region. For an async fn, run()
// gives a promise of the result in the region.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const isRegion = (value) => Region.isRegionObject(value);
const tick = () => new Promise((resolve) => resolve());

function make(n) {
  'use region';
  return { n, list: [n] };
}

async function helper(n) {
  'use region';
  await tick();
  const inner = { n };
  await null;
  return { inner, more: [inner] };
}

(async () => {
  const region = new Region();
  const out = await region.run(async () => {
    const first = make(1);
    await null;
    const second = make(2);
    await tick();
    const third = await helper(3);
    return { first, second, third, plain: [1, 2] };
  });
  check('result in the region', isRegion(out) && Region.of(out) === region);
  check('before the first await', isRegion(out.first) && Region.of(out.first) === region);
  check('after awaits', isRegion(out.second) && isRegion(out.third.inner) &&
        Region.of(out.third.more) === region);
  check('copied into the region', isRegion(out.plain) && out.plain[1] === 2);
  check('not current afterwards', !isRegion(make(4)));

  // Two runs at once: each continues in its own region.
  const a = new Region();
  const b = new Region();
  const both = await Promise.all([
    a.run(async () => { await tick(); const x = make('a'); await null; return [x, make('a2')]; }),
    b.run(async () => { await null; const y = make('b'); await tick(); return [y, make('b2')]; }),
  ]);
  check('interleaved runs', Region.of(both[0][0]) === a && Region.of(both[0][1]) === a &&
        Region.of(both[1][0]) === b && Region.of(both[1][1]) === b);

  // A promise callback added inside run().
  let later;
  const sync = region.run(() => {
    later = tick().then(() => make(5));
    return make(6);
  });
  check('sync run is not a promise', isRegion(sync) && !(sync instanceof Promise));
  const fromThen = await later;
  check('then callback', isRegion(fromThen) && Region.of(fromThen) === region);

  // An async function started inside and awaited outside.
  let started;
  region.run(() => { started = helper(7); });
  const fromStarted = await started;
  check('started inside, awaited outside', Region.of(fromStarted.inner) === region);
  check('still not current here', !isRegion(make(8)));

  // Timers are not continuations.
  const fromTimer = await region.run(() => new Promise((resolve) => {
    setTimeout(() => resolve(isRegion(make(9))), 0);
  }));
  check('timer callback', fromTimer === false);

  // Errors reject the promise; nested runs.
  let message = 'no error';
  try {
    await region.run(async () => { await null; throw new Error('boom'); });
  } catch (e) {
    message = e.message;
  }
  check('rejection', message === 'boom');
  const other = new Region();
  const nested = await region.run(async () => {
    await null;
    const inner = other.run(() => make(10));
    await null;
    return { outer: make(11), innerIsOther: Region.of(inner) === other };
  });
  check('nested run', nested.innerIsOther && Region.of(nested.outer) === region);
  check('still not current at the end', !isRegion(make(12)));

  // In a task: the task and the region both follow the continuation.
  const inTask = spawn(async () => {
    function build(n) {
      'use region';
      return { n };
    }
    const r = new Region();
    const value = await r.run(async () => {
      await null;
      const x = build(1);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { x, y: build(2) };
    });
    return Region.of(value.x) === r && Region.of(value.y) === r && !Region.isRegionObject(build(3));
  }).join();
  check('in a task', inTask === true);

  gc();
  check('after gc', out.third.inner.n === 3 && both[1][1].n === 'b2');
  print('done');
})().catch((e) => {
  print('FAIL', e, e.stack);
});

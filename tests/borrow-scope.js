// d8 --harmony-regions borrow-scope.js
// Borrows taken in a task end with the task; borrowWhile() keeps one for
// async work.
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

// borrowWhile on main: sync result, async result, exceptions.
{
  const region = new Region();
  const config = region.run(() => ({ name: 'prod' }));
  region.freeze();
  print('sync:', region.borrowWhile(() => region.readers + ' ' + config.name),
        'after:', region.readers);
  const pending = region.borrowWhile(async () => {
    await sleep();
    return region.readers;
  });
  print('while pending:', region.readers);
  print('async:', await pending, 'after:', region.readers);
  try {
    region.borrowWhile(() => { throw new Error('boom'); });
  } catch (e) {
    print('throws:', e.message, 'after:', region.readers);
  }
  await region.borrowWhile(async () => { throw new Error('async boom'); })
      .catch((e) => print('rejects:', e.message, 'after:', region.readers));
  region.thaw();
  try {
    region.borrowWhile(() => 1);
  } catch (e) {
    print('not frozen:', e.message);
  }
}

// A borrow left behind by a task is released when the task ends, so main can
// thaw; a later read in the worker then fails there.
{
  const state = new Region().run(() => ({ counter: 1 }));
  Region.of(state).freeze();
  await Promise.all([0, 1].map((i) => spawn(() => {
    const borrow = Region.of(state).borrow();
    setTimeout(() => {
      try {
        print('late read', i, state.counter);
      } catch (e) {
        print('late read', i, 'failed:', e.message);
      }
    }, 0);
  })));
  print('leaked readers after tasks:', Region.of(state).readers);
  Region.of(state).thaw();
  state.counter++;
  print('main after thaw:', state.counter);
}

// borrowWhile keeps the borrow until the async work is done.
{
  const state = new Region().run(() => ({ counter: 5 }));
  Region.of(state).freeze();
  const seen = await Promise.all([0, 1, 2].map((i) => spawn(() =>
    Region.of(state).borrowWhile(async () => {
      await sleep();
      await sleep();
      return Region.of(state).readers > 0 ? state.counter + i : -1;
    }))));
  print('borrowWhile results:', seen.join(','),
        'readers:', Region.of(state).readers);
  Region.of(state).thaw();
  print('thawed:', !Region.of(state).frozen);
}

// `using` releases normally, without a warning.
{
  const state = new Region().run(() => ({ n: 7 }));
  Region.of(state).freeze();
  print('using:', await spawn(() => {
    using borrow = Region.of(state).borrow();
    return state.n;
  }), 'readers:', Region.of(state).readers);
}

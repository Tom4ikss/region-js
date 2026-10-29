// d8 --harmony-regions --verify-heap spawn-this.js
const expectError = (name, fn) => {
  try {
    fn();
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};

// Lexical this and arguments of an arrow callback.
function summary(prefix) {
  return spawn(() => `${prefix}${this.title}: ${this.rows.length} rows, ${arguments.length} args`).join();
}
print('this + arguments:', summary.call({ title: 'weekly', rows: [3, 1, 2] }, '>> ', 'extra'));
print('top-level this:', spawn(() => typeof this).join());
print('function expression this:', spawn(function () { return this === undefined || this === globalThis; }).join());

// this with methods cannot be copied: the error names it.
const store = {
  items: [1, 2, 3],
  count() { return spawn(() => this.items.length).join(); },
};
expectError('this with methods', () => store.count());

// Regions moved into a task come back after it, like std::thread::scope.
const region = new Region();
const state = region.run(() => ({ hits: 0, log: ['', '', ''] }));
for (let i = 0; i < 3; i++) {
  spawn((n) => {
    state.hits += 1;
    state.log[n] = 'task ' + n;
  }, i).join();
}
print('scoped regions return:', state.hits, state.log.join(','));

(async () => {
  await spawn(() => { state.hits += 10; });
  print('after await:', state.hits);

  // The region comes back even if the task fails.
  try {
    await spawn(() => { state.hits += 100; throw new Error('boom'); });
  } catch (e) {
    print('after failure:', e.message, state.hits);
  }

  // Returning the captured region object itself.
  const same = await spawn(() => state);
  print('returned region object is the same:', same === state, same.hits);

  // Classes are not supported.
  class Point { constructor(x) { this.x = x; } }
  expectError('captured class', () => spawn(() => new Point(1)));
  expectError('class inside callback', () => spawn(() => { class A {} return new A(); }));
})();

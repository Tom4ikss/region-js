// d8 --harmony-regions --module --verify-heap direct.js
// Writing into a region without copying: region.enter() makes it current,
// #{} and #[] create objects in it, and arrays grow. run() adds objects to a
// region named explicitly, as in a task.
const expectError = (name, fn) => {
  try {
    print(`${name}: NO ERROR ->`, fn());
  } catch (e) {
    print(`${name}:`, e.message);
  }
};

const region = new Region();
let state;
{
  using _ = region.enter();
  state = #{ orders: #[], total: 0, owner: 'shop' };
  for (let i = 0; i < 5; i++) {
    state.orders.push(#{ id: i, price: 10 * (i + 1), tags: #['new'] });
    state.total += 10 * (i + 1);
  }
}
print('in region:', Region.of(state).id === region.id, Region.of(state.orders[3]).id === region.id);
print('orders:', state.orders.length, 'total:', state.total, 'last:', JSON.stringify(state.orders[4]));
expectError('literal outside enter', () => #{ a: 1 });
print('explicit region.run:', Region.of(region.run(() => ({ b: 2 }))).id === region.id);
print('explicit array:', JSON.stringify(region.run(() => [1, 'two', null])));
expectError('plain object pushed', () => state.orders.push({ id: 99 }));
expectError('enter a region we do not own', () => {
  const other = new Region();
  other.freeze();
  other.enter();
});

// Nested enter: the innermost region is current; leaving restores the outer.
{
  const a = new Region();
  const b = new Region();
  using _a = a.enter();
  const inA = #{ where: 'a' };
  {
    using _b = b.enter();
    print('inner is b:', Region.of(#{ where: 'b' }).id === b.id);
  }
  print('after inner, current is a:', Region.of(#{}).id === a.id,
        Region.of(inA).id === a.id);
}

// run() makes the region current too.
const fromRun = region.run(() => ({ list: #[1, 2, 3] }));
print('#[] inside run:', JSON.stringify(fromRun), Region.of(fromRun.list).id === region.id);

// Arrays grow and shrink.
const list = region.run(() => #[]);
for (let i = 0; i < 100000; i++) list.push(i);
print('pushed:', list.length, list[99999], 'pop:', list.pop(), list.length);
list.length = 2;
print('truncated:', JSON.stringify(list));
list[4] = 'gap';
print('gap:', JSON.stringify(list), list.length);
print('splice:', JSON.stringify(list.splice(1, 2)), JSON.stringify(list));
print('keys:', JSON.stringify(Object.keys(list)), 'for-of:', [...list].length);

// The region still moves as a whole, grown arrays included.
const moved = await spawn(() => {
  // A task has no current region: it may hold several. Name it.
  const region = Region.of(state);
  state.orders.push(region.run(() => ({ id: 5, price: 60, tags: [] })));
  return state.orders.length;
});
print('task appended, main sees:', moved, state.orders.length, state.orders[5].price);

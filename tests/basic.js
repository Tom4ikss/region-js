// d8 --harmony-regions basic.js
const region = new Region();
const tree = region.run(() => ({ value: 1, left: { value: 2 }, right: null }));
print('owner reads:', tree.left.value);

tree.value = 10;
print('owner writes:', tree.value);

try {
  tree.value = {};
} catch (e) {
  print('local object:', e.message);
}
try {
  tree.extra = 1;
} catch (e) {
  print('new property:', e.message);
}

const list = region.run(() => [1, 'two', { three: 3 }]);
print('array:', list.length, list[0], list[1], list[2].three);

const cyclic = region.run(() => {
  const a = { name: 'a' };
  a.self = a;
  return a;
});
print('cycle kept:', cyclic.self === cyclic);

const w = new Worker(
  `onmessage = ({ data }) => postMessage(data.tree.left.value + data.tree.value)`,
  { type: 'string' },
);
w.postMessage({ tree }, [region]);
try {
  tree.value;
} catch (e) {
  print('after move:', e.message);
}
print('worker got:', w.getMessage());
print('region owner:', region.owner);
w.terminate();

// One handle per region in a thread: Region.of() of any object of a region,
// and the Region it was created with, are the same object.
{
  const r = new Region();
  const a = r.run(() => ({ x: 1 }));
  const b = r.run(() => [1, 2]);
  const other = new Region().run(() => ({}));
  print('same handle:', Region.of(a) === Region.of(b), Region.of(a) === r,
        Region.of(other) !== r);
}

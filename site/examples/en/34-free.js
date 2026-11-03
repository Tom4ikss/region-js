// d8-flags: --module --expose-gc
// free(): nobody will touch the region again, and its memory is released at once.
const region = new Region();
const tree = region.run(() => ({
  name: 'tree',
  samples: new Float64Array(1 << 20),
  nodes: Array.from({ length: 10000 }, (_, i) => ({ i })),
}));
print('bytes in the region:', region.byteSize);
const samples = tree.samples;

region.free();
print('freed:', region.freed, '| bytes after:', region.byteSize);
print('view after free:', samples.length);
try {
  print(tree.name);
} catch (e) {
  print('access after free:', String(e));
}

// using frees the region at the end of the block.
let leaked;
{
  using temp = new Region();
  leaked = temp.run(() => ({ draft: true }));
}
try {
  leaked.draft;
} catch (e) {
  print('after the using block:', String(e));
}
print('live regions:', Region.stats().regions, '| freed:', Region.stats().freed);

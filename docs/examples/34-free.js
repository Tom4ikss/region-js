// d8-flags: --module --expose-gc
// free(): регион больше никто не тронет, память отдаётся сразу.
const region = new Region();
const tree = region.run(() => ({
  name: 'дерево',
  samples: new Float64Array(1 << 20),
  nodes: Array.from({ length: 10000 }, (_, i) => ({ i })),
}));
print('байт в регионе:', region.byteSize);
const samples = tree.samples;

region.free();
print('освобождён:', region.freed, '| байт после:', region.byteSize);
print('view после free:', samples.length);
try {
  print(tree.name);
} catch (e) {
  print('обращение после free:', e.message);
}

// using освобождает регион в конце блока.
let leaked;
{
  using temp = new Region();
  leaked = temp.run(() => ({ draft: true }));
}
try {
  leaked.draft;
} catch (e) {
  print('после блока using:', e.message);
}
print('живых регионов:', Region.stats().regions, '| освобождённых:', Region.stats().freed);

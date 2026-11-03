// d8-flags: --module
// A task froze a region: the right to thaw comes back together with the result.
const index = await spawn(() => {
  const region = new Region();
  const built = region.run(() => ({ words: ['apple', 'banana', 'cherry'], built: true }));
  region.freeze(); // a finished lookup table: read-only
  return built;
});
const region = Region.of(index);
print('frozen:', region.frozen, '| frozenHere:', region.frozenHere);

// The frozen result can be handed to other tasks right away, without a copy.
const lengths = await Promise.all([0, 1, 2].map((i) => spawn(() => index.words[i].length)));
print('lengths from three tasks:', lengths.join(', '));

region.thaw(); // the main thread has the right
index.built = false;
print('after thaw the main thread writes:', index.built);

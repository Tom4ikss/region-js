// Read and write rules for the owner.
const tryIt = (label, fn) => {
  try {
    print(label + ':', fn());
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

const region = new Region();
const cart = region.run(() => ({ total: 0, items: [{ id: 1, qty: 2 }], note: null }));

tryIt('number', () => (cart.total = 42));
tryIt('string', () => (cart.note = 'call ' + 'before 18:00'));
tryIt('object from the same region', () => {
  cart.note = cart.items[0];
  return cart.note.qty;
});
tryIt('plain local object', () => (cart.note = { text: 'hello' }));
tryIt('new property', () => (cart.discount = 10));
tryIt('reading a missing field', () => cart.discount);

// Cycles and shared parts of the graph are preserved.
const graph = region.run(() => {
  const a = { name: 'a' };
  const b = { name: 'b', peer: a };
  a.peer = b;
  return { a, b };
});
tryIt('cycle preserved', () => graph.a.peer.peer === graph.a);

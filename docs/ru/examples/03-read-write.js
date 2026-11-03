// Правила чтения и записи для владельца.
const tryIt = (label, fn) => {
  try {
    print(label + ':', fn());
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

const region = new Region();
const cart = region.run(() => ({ total: 0, items: [{ id: 1, qty: 2 }], note: null }));

tryIt('число', () => (cart.total = 42));
tryIt('строка', () => (cart.note = 'позвонить ' + 'до 18:00'));
tryIt('объект из того же региона', () => {
  cart.note = cart.items[0];
  return cart.note.qty;
});
tryIt('обычный локальный объект', () => (cart.note = { text: 'привет' }));
tryIt('новое свойство', () => (cart.discount = 10));
tryIt('чтение несуществующего', () => cart.discount);

// Циклы и общие части графа сохраняются.
const graph = region.run(() => {
  const a = { name: 'a' };
  const b = { name: 'b', peer: a };
  a.peer = b;
  return { a, b };
});
tryIt('цикл сохранился', () => graph.a.peer.peer === graph.a);

// What spawn rejects right away, at the call site, and which errors come from the thread.
const tryIt = (label, fn) => {
  try {
    fn();
    print(label + ': no error');
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

const log = print;
tryIt('built-in function', () => spawn(() => log('x')));
tryIt('eval', () => spawn(() => eval('1 + 1')));
tryIt('class', () => spawn(() => { class A {} return new A(); }));
class Point { constructor(x) { this.x = x; } }
tryIt('captured class', () => spawn(() => new Point(1)));
tryIt('object method', () => spawn({ m() { return 1; } }.m));
tryIt('not a function', () => spawn(42));
tryIt('before initialization', () => {
  const start = () => spawn(() => later + 1);
  start();
  let later = 1;
});
const make = (k) => () => k;
const readA = make('a');
const readB = make('b');
tryIt('one name, different values', () => spawn(() => readA() + readB()));
tryIt('Map as an argument', () => spawn((m) => m.size, new Map()));

// Errors from the thread keep their type.
tryIt('throw in the thread', () => spawn(() => { throw new RangeError('too far'); }).join());
tryIt('the result cannot be moved', () => spawn(() => new Map()).join());
tryIt('second join', () => {
  const task = spawn(() => ({ n: 1 }));
  if (task.join() !== task.join()) throw new Error('different results');
});

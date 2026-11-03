// Что spawn отклоняет сразу, в месте вызова, и какие ошибки приходят из потока.
const tryIt = (label, fn) => {
  try {
    fn();
    print(label + ': без ошибки');
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

const log = print;
tryIt('встроенная функция', () => spawn(() => log('x')));
tryIt('eval', () => spawn(() => eval('1 + 1')));
tryIt('класс', () => spawn(() => { class A {} return new A(); }));
class Point { constructor(x) { this.x = x; } }
tryIt('захваченный класс', () => spawn(() => new Point(1)));
tryIt('метод объекта', () => spawn({ m() { return 1; } }.m));
tryIt('не функция', () => spawn(42));
tryIt('до инициализации', () => {
  const start = () => spawn(() => later + 1);
  start();
  let later = 1;
});
const make = (k) => () => k;
const readA = make('a');
const readB = make('b');
tryIt('одно имя, разные значения', () => spawn(() => readA() + readB()));
tryIt('Map в аргументе', () => spawn((m) => m.size, new Map()));

// Ошибки из потока сохраняют тип.
tryIt('throw в потоке', () => spawn(() => { throw new RangeError('too far'); }).join());
tryIt('результат нельзя переместить', () => spawn(() => new Map()).join());
tryIt('второй join', () => {
  const task = spawn(() => ({ n: 1 }));
  if (task.join() !== task.join()) throw new Error('разные результаты');
});

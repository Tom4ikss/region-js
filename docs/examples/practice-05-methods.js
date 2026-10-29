// Практика 5. Методы массива на массиве региона, обычный цикл и локальная копия.
// Сумма квадратов чётных чисел в массиве из 1 000 000 элементов.
const region = new Region();
const numbers = region.run(() => Array.from({ length: 1_000_000 }, (_, i) => i % 1000));

// Функции продублированы, чтобы подсказки движка для массива региона
// и для обычного массива не смешивались в одном месте кода.
const methodsOnRegion = () => numbers.filter((x) => x % 2 === 0).map((x) => x * x).reduce((a, b) => a + b, 0);
const loopOnRegion = () => {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    const x = numbers[i];
    if (x % 2 === 0) total += x * x;
  }
  return total;
};
const copyByLoop = () => {
  const local = new Array(numbers.length);
  for (let i = 0; i < numbers.length; i++) local[i] = numbers[i];
  return local;
};
const methodsOnCopy = () => copyByLoop().filter((x) => x % 2 === 0).map((x) => x * x).reduce((a, b) => a + b, 0);
const loopOnCopy = () => {
  const local = copyByLoop();
  let total = 0;
  for (let i = 0; i < local.length; i++) {
    const x = local[i];
    if (x % 2 === 0) total += x * x;
  }
  return total;
};

const best = (fn) => {
  let min = Infinity;
  for (let rep = 0; rep < 7; rep++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return min.toFixed(2).padStart(6);
};
print(`регион, filter/map/reduce:          ${best(methodsOnRegion)} ms`);
print(`регион, цикл for:                   ${best(loopOnRegion)} ms`);
print(`копия циклом, filter/map/reduce:    ${best(methodsOnCopy)} ms`);
print(`копия циклом, цикл for:             ${best(loopOnCopy)} ms`);
print('результаты совпадают:', methodsOnRegion() === loopOnRegion() && loopOnCopy() === methodsOnCopy());

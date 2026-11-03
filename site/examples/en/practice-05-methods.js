// Practice 5. Array methods on a region array, on a copy and on a plain array; a for loop.
// The sum of squares of the even numbers in an array of 1,000,000 elements.
const region = new Region();
const numbers = region.run(() => Array.from({ length: 1_000_000 }, (_, i) => i % 1000));
const plain = Array.from({ length: 1_000_000 }, (_, i) => i % 1000);   // the same values, outside a region

// The functions are duplicated so that the engine's feedback for the region array
// and for the plain array does not mix in one place in the code.
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

const methodsOnPlain = () => plain.filter((x) => x % 2 === 0).map((x) => x * x).reduce((a, b) => a + b, 0);
const loopOnPlain = () => {
  let total = 0;
  for (let i = 0; i < plain.length; i++) {
    const x = plain[i];
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
print(`region, filter/map/reduce:          ${best(methodsOnRegion)} ms`);
print(`region, for loop:                   ${best(loopOnRegion)} ms`);
print(`loop copy, filter/map/reduce:       ${best(methodsOnCopy)} ms`);
print(`loop copy, for loop:                ${best(loopOnCopy)} ms`);
print(`plain array, filter/map/reduce:     ${best(methodsOnPlain)} ms`);
print(`plain array, for loop:              ${best(loopOnPlain)} ms`);
const expected = loopOnPlain();
print('results match:', [methodsOnRegion, loopOnRegion, methodsOnCopy, loopOnCopy, methodsOnPlain]
  .every((fn) => fn() === expected));

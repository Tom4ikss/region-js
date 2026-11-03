// Practice 9. Many numbers go into a typed array, not into a plain region array.
// The sum and writes of 1,000,000 numbers: an array of numbers in a region, a Float64Array
// in a region, and a plain Float64Array that has nothing to do with regions.
const N = 1_000_000;
const region = new Region();
const data = region.run(() => ({
  list: Array.from({ length: N }, (_, i) => i % 1000),        // array of numbers
  samples: Float64Array.from({ length: N }, (_, i) => i % 1000), // typed array
}));
const plain = Float64Array.from({ length: N }, (_, i) => i % 1000);

// The functions are duplicated so that the engine's feedback does not mix in one place in the code.
const sumRegionArray = () => {
  const list = data.list;
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
};
const sumRegionTyped = () => {
  const samples = data.samples; // a local view over the region's memory
  let total = 0;
  for (let i = 0; i < samples.length; i++) total += samples[i];
  return total;
};
const sumPlainTyped = () => {
  let total = 0;
  for (let i = 0; i < plain.length; i++) total += plain[i];
  return total;
};

const writeRegionArray = () => {
  const list = data.list;
  for (let i = 0; i < list.length; i++) list[i] = (i * 7) % 1000;
};
const writeRegionTyped = () => {
  const samples = data.samples;
  for (let i = 0; i < samples.length; i++) samples[i] = (i * 7) % 1000;
};
const writePlainTyped = () => {
  for (let i = 0; i < plain.length; i++) plain[i] = (i * 7) % 1000;
};

const best = (fn) => {
  let min = Infinity;
  for (let rep = 0; rep < 7; rep++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return min.toFixed(2).padStart(5);
};
print(`sum, array of numbers in a region:    ${best(sumRegionArray)} ms`);
print(`sum, Float64Array in a region:        ${best(sumRegionTyped)} ms`);
print(`sum, plain Float64Array:              ${best(sumPlainTyped)} ms`);
print(`writes, array of numbers in a region: ${best(writeRegionArray)} ms`);
print(`writes, Float64Array in a region:     ${best(writeRegionTyped)} ms`);
print(`writes, plain Float64Array:           ${best(writePlainTyped)} ms`);
print('results match:', sumRegionArray() === sumRegionTyped() && sumRegionTyped() === sumPlainTyped());

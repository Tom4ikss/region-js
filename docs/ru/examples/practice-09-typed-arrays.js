// Практика 9. Много чисел — в типизированный массив, а не в обычный массив региона.
// Сумма и запись 1 000 000 чисел: массив чисел в регионе, Float64Array в регионе
// и обычный Float64Array, который регионов не касается.
const N = 1_000_000;
const region = new Region();
const data = region.run(() => ({
  list: Array.from({ length: N }, (_, i) => i % 1000),        // массив чисел
  samples: Float64Array.from({ length: N }, (_, i) => i % 1000), // типизированный массив
}));
const plain = Float64Array.from({ length: N }, (_, i) => i % 1000);

// Функции продублированы, чтобы подсказки движка не смешивались в одном месте кода.
const sumRegionArray = () => {
  const list = data.list;
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
};
const sumRegionTyped = () => {
  const samples = data.samples; // локальный view над памятью региона
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
print(`сумма, массив чисел в регионе:   ${best(sumRegionArray)} ms`);
print(`сумма, Float64Array в регионе:   ${best(sumRegionTyped)} ms`);
print(`сумма, обычный Float64Array:     ${best(sumPlainTyped)} ms`);
print(`запись, массив чисел в регионе:  ${best(writeRegionArray)} ms`);
print(`запись, Float64Array в регионе:  ${best(writeRegionTyped)} ms`);
print(`запись, обычный Float64Array:    ${best(writePlainTyped)} ms`);
print('результаты совпадают:', sumRegionArray() === sumRegionTyped() && sumRegionTyped() === sumPlainTyped());

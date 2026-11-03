// Практика 6. Одинаковая форма объектов: те же ключи в том же порядке.
// Сумма поля x по 100 000 объектов региона, 20 проходов.
const N = 100_000;
const PASSES = 20;
const KEYS = ['x', 'y', 'z', 'w'];
const permutations = (list) =>
  list.length <= 1 ? [list] : list.flatMap((k, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [k, ...p]));
const ORDERS = permutations(KEYS); // 24 порядка ключей

// shapes — сколько разных порядков ключей встречается в массиве.
const make = (shapes) => Array.from({ length: N }, (_, i) => {
  const o = {};
  for (const key of ORDERS[i % shapes]) o[key] = i;
  return o;
});
// Каждому замеру своя копия функции (new Function с уникальным комментарием, иначе
// движок возьмёт её из кэша), чтобы подсказки inline cache не смешивались.
let copies = 0;
const makeSumX = () => new Function('list', `// копия ${++copies}
  let total = 0;
  for (let p = 0; p < ${PASSES}; p++)
    for (let i = 0; i < list.length; i++) total += list[i].x;
  return total;
`);

const best = (list) => {
  const sumX = makeSumX();
  let min = Infinity;
  for (let rep = 0; rep < 5; rep++) {
    const t = performance.now();
    sumX(list);
    min = Math.min(min, performance.now() - t);
  }
  return min.toFixed(1).padStart(6);
};
for (const shapes of [1, 4, 24]) {
  const region = new Region();
  const inRegion = region.run(() => make(shapes));
  const plain = make(shapes);
  print(`разных форм ${String(shapes).padStart(2)}: регион ${best(inRegion)} ms | обычные объекты ${best(plain)} ms`);
}

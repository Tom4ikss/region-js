// Типизированные массивы в регионе.
const pixels = new Uint8Array([10, 20, 30, 40]);
const region = new Region();
const image = region.run(() => ({ width: 2, height: 2, pixels }));

// По умолчанию массив копируется в регион, исходный остаётся нашим.
image.pixels[0] = 99;
print('в регионе:', image.pixels[0], '| исходный:', pixels[0]);

// Каждое чтение поля даёт новый view над той же памятью региона.
const view = image.pixels;
print('тот же объект?', image.pixels === view, '| те же байты?', image.pixels[0] === view[0]);
print('это обычный Uint8Array:', view instanceof Uint8Array, view.length);

// Поле можно заменить другим массивом, даже другой длины: он тоже копируется.
image.pixels = new Uint8Array(16);
print('новая длина:', image.pixels.length);

// transfer: буфер переезжает в регион без копии, исходный отсоединяется.
const copySource = new Float64Array(1_000_000).fill(0.5);
let start = performance.now();
const copied = new Region().run(() => ({ samples: copySource }));
const copyMs = performance.now() - start;

const big = new Float64Array(1_000_000).fill(0.5);
start = performance.now();
const moved = new Region().run(() => ({ samples: big }), [big.buffer]);
const transferMs = performance.now() - start;

print(`8 МБ копией: ${copyMs.toFixed(2)} ms, через transfer: ${transferMs.toFixed(2)} ms`);
print('исходный после transfer:', big.length, '| в регионе:', moved.samples.length, copied.samples.length);

// d8-flags: --module
// Функции в регионе: Region.fn.
const area = Region.fn(function () {
  return this.w * this.h;
});

const region = new Region();
const shapes = region.run(() => [
  { w: 2, h: 3, area },
  { w: 4, h: 5, area },
]);
print('площади:', shapes.map((s) => s.area()).join(', '));
print('та же функция:', shapes[0].area === area);

// Задача получает регион вместе с функциями. Её поток компилирует функцию
// из исходного текста один раз и дальше берёт готовую.
const total = await spawn(() => shapes.reduce((sum, s) => sum + s.area(), 0));
print('в задаче:', total);

// Замыкание с функцией не переезжает: она видит только свои аргументы,
// this, встроенные глобальные объекты и своё имя.
const rate = 1.2;
try {
  Region.fn((x) => x * rate);
} catch (e) {
  print(e.name + ': ' + e.message);
}

// Обычную функцию регион не возьмёт.
try {
  region.run(() => ({ f: (x) => x * 2 }));
} catch (e) {
  print(e.name + ': ' + e.message);
}

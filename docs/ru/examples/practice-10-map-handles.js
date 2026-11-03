// d8-flags: --module
// Практика 10. Колбэк map должен вернуть ручку задачи, а не что-то другое.
const heavy = (n) => {
  let t = 0;
  for (let i = 0; i < n; i++) t = (t + i * i) % 1000003;
  return t;
};
const parts = [0, 1, 2, 3];

// Плохо: колбэк запускает задачу, но возвращает номер части.
let start = performance.now();
const bad = await Promise.all(parts.map((i) => {
  spawn(heavy, 20_000_000);
  return i;
}));
print(`плохо:  Promise.all вернул [${bad}] через ${(performance.now() - start).toFixed(1)} ms`);
await spawn.idle();
print(`        задачи закончились через ${(performance.now() - start).toFixed(0)} ms`);

// Хорошо: колбэк возвращает ручку, Promise.all ждёт сами задачи.
start = performance.now();
const good = await Promise.all(parts.map(() => spawn(heavy, 20_000_000)));
print(`хорошо: Promise.all вернул результаты через ${(performance.now() - start).toFixed(0)} ms, ` +
  `все одинаковые: ${good.every((v) => v === good[0])}`);

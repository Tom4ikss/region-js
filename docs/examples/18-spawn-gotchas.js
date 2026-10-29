// Три вещи, о которых легко забыть.
const tryIt = (label, fn) => {
  try {
    print(label + ':', fn());
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

// 1. Обычные данные (захваченные или аргументом) копируются. Изменения в потоке назад не приходят.
let counter = 0;
const settings = { theme: 'dark' };
tryIt('в потоке', () => spawn((s) => { s.theme = 'light'; return ++counter; }, settings).join());
tryIt('в главном', () => counter + ', ' + settings.theme);

// 2. Чтобы изменения вернулись, данные должны лежать в регионе.
const region = new Region();
const state = region.run(() => ({ hits: 0 }));
spawn((s) => { s.hits += 1; }, state).join();
spawn(() => { state.hits += 1; }).join();
tryIt('регион после двух задач', () => state.hits);

// 3. Результат лежит в регионе: форма фиксирована.
const result = spawn(() => ({ total: 10, items: [1, 2] })).join();
result.total += 1;
tryIt('запись в результат', () => result.total);
tryIt('новое поле', () => (result.extra = 1));
tryIt('обычная копия', () => {
  const plain = { ...result, extra: 1 }; // поверхностная копия, items по-прежнему в регионе
  return JSON.stringify(plain);
});

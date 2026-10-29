# region-js

*Ownership regions for JavaScript: an experimental V8 fork where plain JS objects live in shared memory, have a single owner thread, move between threads in O(1) and can be shared read-only. Research prototype, alpha.*

Экспериментальный форк V8, в котором у обычных объектов JS появляется владелец. Объекты лежат в общей памяти, переезжают между потоками за O(1) без копирования, а читать их параллельно можно после заморозки. Гонок данных нет: движок проверяет владельца при каждом обращении. Идея взята из Rust, удобство — из Go.

```js
const state = new Region().run(() => ({ orders: [{ price: 10 }, { price: 32 }], total: 0 }));

// Задача в другом потоке: регион переезжает туда и возвращается обратно.
await spawn(() => {
  for (const order of state.orders) state.total += order.price;
});
print('total:', state.total); // 42

// Каналы, как в Go: регион, отправленный в канал, переезжает без копии.
const jobs = new Channel(8);
const worker = spawn(async () => {
  let sum = 0;
  for await (const job of jobs) sum += job.payload.length;
  return sum;
});
await jobs.send(new Region().run(() => ({ id: 1, payload: [1, 2, 3] })));
jobs.close();
print('payload items:', await worker); // 3
```

Работает только в тестовой оболочке движка `d8`, в браузер и Node это не попадает.

**Документация:** https://tom4ikss.github.io/region-js/ · **Релиз:** [v0.1.0-alpha](https://github.com/Tom4ikss/region-js/releases/tag/v0.1.0-alpha)

## Что умеет

- **Регионы.** `new Region()`, `region.run(fn)` копирует простые объекты, массивы, строки и типизированные массивы в общую кучу. Читать и писать может только владелец, остальные получают `OwnershipError`.
- **Переезд.** `postMessage(msg, [region])` отдаёт регион другому потоку без копии, у отправителя доступ пропадает. Миллион узлов переезжает за ~0,1 мс против ~930 мс у structured clone.
- **Заморозка.** `freeze()` / `thaw()` / `borrow()` / `borrowWhile()`: замороженный регион читают все потоки сразу, без копий и блокировок.
- **TypedArray** в регионе на полной скорости, с безопасным отсоединением view.
- **`spawn(fn, ...args)`** — функция в пуле воркеров одной строкой, ~3,5 мкс на задачу. Нужные переменные находит сам, регионы перемещает и возвращает, вложенные задачи заканчиваются раньше внешней, ошибки не теряются.
- **Каналы** `new Channel(capacity)` с `send` / `recv` / `close` / `select`, `for await`, блокирующими версиями для воркеров.
- **`free()`** и `using`: освободить регион сразу, без ожидания GC, безопасно.
- **Песочница для VSCode:** типы, правила Biome и плагин ESLint, который ловит гонки владения до запуска.
- **Документация на русском** с примерами, у каждого из которых настоящий вывод d8, и микробенчмарками «плохо / хорошо».

## Как запустить

Нужны macOS или Linux, git, Python 3, около 10 ГБ места и терпение: V8 собирается долго.

```sh
scripts/setup.sh                     # depot_tools, V8 на нужном коммите, патч, сборка d8
v8-src/v8/out/release/d8 --harmony-regions --module tests/channels.js
```

Документация — на [сайте](https://tom4ikss.github.io/region-js/) или в `docs/index.html`, её можно открыть прямо из файла. Пересобрать с выводом примеров: `python3 docs/_build/build.py`.

Песочница: откройте папку `playground/` в VSCode, выполните `npm install`, запуск открытого файла — Cmd+Shift+B. Подробнее в `playground/README.md`.

## Что где лежит

| Папка | Что там |
|---|---|
| `v8/regions.patch` | Сам форк: патч поверх V8 `v8/BASE`, флаги сборки в `v8/args.gn` |
| `docs/` | Сайт с документацией, его исходники в `docs/_build`, примеры в `docs/examples` |
| `tests/` | Тесты и бенчмарки регионов, `spawn`, каналов и `free()`, фаззер |
| `playground/` | Типы, Biome, ESLint-плагин и примеры для VSCode |
| `prototype/js-ownership/` | Первая версия идеи на чистом JS поверх `SharedArrayBuffer` |
| `DESIGN.md` | Дизайн и что из него реализовано |

## Статус

Alpha. Тесты V8 (mjsunit, 9 255) проходят, свои тесты и фаззер — тоже, но это исследовательский прототип: проверки безопасности уровня настоящего V8 не было, чужой код в нём не запускайте. Что не сделано и почему — на странице `docs/limits.html`.

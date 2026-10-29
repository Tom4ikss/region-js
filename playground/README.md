# Песочница для регионов

Открой эту папку в VSCode целиком (File → Open Folder), чтобы подхватились типы и правила.

- **Автокомплит и ошибки типов** — встроенный TypeScript читает `types/regions.d.ts`
  через `jsconfig.json`, ничего ставить не нужно.
- **Правила Biome и ESLint** — поставь расширения Biome и ESLint (VSCode предложит их сам)
  и выполни `npm install`. Правила Biome лежат в `rules/*.grit`, правило ESLint — в
  `eslint-plugin-regions/`: Biome не умеет проверять порядок выполнения, ESLint умеет.
- **Запуск** — Cmd+Shift+B запускает открытый файл через d8 из настройки
  `regions.d8Path` в `.vscode/settings.json`.

Из терминала:

```sh
npm run typecheck   # ошибки типов
npm run lint          # правила Biome
npm run lint:regions  # правило ESLint про регионы в задачах
npm run test:rules    # тесты правила ESLint
```

`examples/demo.js` — рабочий пример, `examples/channels.js` — конвейер на каналах,
`examples/mistakes.js` — типичные ошибки,
каждая должна подсветиться.

Что ловится в редакторе:

| Ошибка | Чем ловится |
|---|---|
| класс, `Map`, функция в `region.run` | типы |
| опечатка в методе региона, новое поле у объекта региона | типы |
| `class` внутри колбэка `spawn` | Biome |
| `eval` / `with` в колбэке `spawn` | Biome |
| метод объекта как колбэк (`spawn(Math.max)`) | Biome |
| `spawn(...).join()` на main thread | Biome, предупреждение |
| `spawn(...)` без `await` / `join()` | ESLint, `regions/no-floating-spawn`, предупреждение |
| обращение к захваченному региону, пока задача идёт | ESLint, `regions/no-region-use-while-spawned` |
| `borrowWhile(async ...)`, промис которого никто не ждёт | ESLint, `regions/no-floating-borrow-while` |

Что видно только при запуске: захваченный `this` с методами, захват переменной до её
инициализации, доступ к региону без владения.

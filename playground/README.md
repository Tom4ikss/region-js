# Песочница для регионов

Открой эту папку в VSCode целиком (File → Open Folder), чтобы подхватились типы и правила.

- **Автокомплит и ошибки типов** — встроенный TypeScript читает `types/regions.d.ts`
  через `jsconfig.json`, ничего ставить не нужно.
- **Правила Biome и ESLint** — поставь расширения Biome и ESLint (VSCode предложит их сам)
  и выполни `npm install`. Правила Biome лежат в `rules/*.grit`, правила ESLint — в
  `eslint-plugin-regions/`: Biome не умеет проверять порядок выполнения, ESLint умеет.
- **Запуск** — Cmd+Shift+B запускает открытый файл через d8 из настройки
  `regions.d8Path` в `.vscode/settings.json`.

`.npmrc` здесь включает `omit-lockfile-registry-resolved`: в `package-lock.json` нет адресов
архивов, только версии и хеши, а пакеты берутся из того registry, который настроен у вас.

Из терминала:

```sh
npm run typecheck   # ошибки типов
npm run lint          # правила Biome
npm run lint:regions  # правила ESLint про регионы, задачи и локи
npm run test:rules    # тесты правил ESLint
```

`experimental/` — файлы с литералами `#{}`. В `npm run typecheck` они не входят: `tsc` из
командной строки `#{}` не разбирает. В VS Code их проверяет свой `experimental/jsconfig.json`
через плагин из расширения `vscode-region-literals` (его нужно поставить, см. README расширения).

`experimental/whats-new.js` — тур по новым API: литералы без отдельного флага, запись
в регион в задаче, `spawn.scope`, `spawn.shield` и его таймаут. `examples/demo.js` — рабочий пример, `examples/channels.js` — конвейер на каналах,
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
| регион трогают после `send` в канал | ESLint, `regions/no-use-after-send` |
| задача меняет обычный объект или переменную вызывающего (меняется копия) | ESLint, `regions/no-write-to-spawn-copy` |
| `await`, пока держат guard `RwLock` или `borrow()` | ESLint, `regions/no-await-holding-guard`, предупреждение |
| ссылка из `guard.value` живёт дольше guard | ESLint, `regions/no-guard-value-escape` |
| `if (region.frozen)`, `await`, потом регион | ESLint, `regions/no-stale-region-check`, предупреждение |

Что видно только при запуске: захваченный `this` с методами, захват переменной до её
инициализации, доступ к региону без владения.

# region-js

**English** · [Русский](README.ru.md)

An experimental V8 fork for parallel JavaScript without copies. `spawn(fn)` runs a function on another thread in one line. Objects created under the `'use region'` directive or with the `#{}` literals live in shared memory from the start and move between threads without copying, however many there are. At any moment the data has one owner, and the engine checks this on every access, so there are no data races. The idea comes from Rust, the ergonomics from Go.

```js
// d8 --harmony-regions --module orders.js
const build = (from, to) => {
  'use region'; // every {} and [] below is created right in shared memory
  using _ = new Region().enter();
  const orders = [];
  for (let i = from; i < to; i++) {
    orders.push({ id: i, customer: { name: 'customer ' + (i % 1000) }, items: [{ qty: 1 + (i % 3) }] });
  }
  return orders; // goes to the caller together with its region, without a copy
};

const parts = await Promise.all([0, 1, 2, 3].map((t) => spawn(build, t * 25_000, (t + 1) * 25_000)));
print(parts.flat().length); // 100000

// Channels, as in Go: a region sent into a channel moves without a copy.
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

It runs only in `d8`, the engine's test shell; none of this reaches browsers or Node.

**Documentation:** https://tom4ikss.github.io/region-js/ (in Russian: https://tom4ikss.github.io/region-js/ru/) · **Release:** [v0.5.0-alpha](https://github.com/Tom4ikss/region-js/releases/tag/v0.5.0-alpha)

## Against workers and tokio

Four worker threads, a V8 build without internal checks, best of five runs (`tests/bench-real.js`, `tests/tokio-bench`):

| Scenario | `spawn` + regions | workers + `postMessage` | Rust + tokio |
|---|---|---|---|
| Build 200,000 orders on 4 threads and read them on the main one | 28 ms | 215 ms | 17 ms |
| 200 batches of 1,000 orders: hand off, compute a discount, return | 11 ms | 301 ms | 0.8 ms |
| A catalog of 100,000 products, 4 threads with a million reads each | 19 ms | 57 ms | 1.6 ms |

That is 3–27 times faster than today's workers, because nothing is copied. Still 2–14 times behind tokio: a task is a message to another V8 isolate, and accesses to region objects check the shape and the owner. The breakdown is on the [Numbers](https://tom4ikss.github.io/region-js/numbers/#real) page.

## What it does

- **`spawn(fn, ...args)`**: a function on a worker pool in one line, about 1 µs per task without V8's internal checks. It finds the variables it needs by itself, moves regions there and back, nested tasks finish before the outer one, errors are not lost, and there is cancellation and `JoinSet`.
- **`'use region'` and the `#{}` / `#[]` literals.** Every `{}` and `[]` in a function with the directive is created right in a region, by the machine code itself, without an intermediate copy. The directive is plain JS syntax that TypeScript and linters understand.
- **Channels:** `new Channel(capacity)` with `send` / `recv` / `close` / `select`, `for await`, blocking versions for workers, and deadlock detection. **`RwLock`** for shared mutable data.
- **Shared read-only data.** `Region.share(data)`, like `Arc<T>`: all threads read the same objects without copies or tickets, and the GC frees the memory. Temporary freezing that can be undone: `freeze()` / `borrow()` / `thaw()`.
- **Regions.** `new Region()`; `region.run(fn)` copies a finished graph of plain objects, arrays, strings and typed arrays into the shared heap. Only the owner can read and write, everyone else gets an `OwnershipError`.
- **Typed arrays** in a region at full speed, with safe detaching of views.
- **Workers directly.** `postMessage(msg, [region])` hands a region to a worker without a copy. A million nodes move in ~0.1 ms against ~930 ms with structured clone.
- **`free()`** and `using`: free a region at once, without waiting for the GC, safely.
- **A VSCode playground:** types, Biome rules and an ESLint plugin that catches ownership races before the code runs.
- **Documentation in English and Russian** with examples, each with the real d8 output, and "bad / good" microbenchmarks.

## How to run it

On Linux x64 (and in WSL2) there is no need to build: `scripts/get-d8.sh` downloads the prebuilt d8 from the latest release and installs it as `~/.local/bin/d8` and `v8-src/v8/out/release/d8`. The same d8 is in the image `docker run --rm -it ghcr.io/tom4ikss/region-js`.

To build it yourself you need macOS or Linux (WSL2 works too), git, Python 3, about 15 GB of disk and patience: V8 takes a while to build.

```sh
scripts/setup.sh                     # depot_tools, V8 at the right commit, the patch, a d8 build
v8-src/v8/out/release/d8 --harmony-regions --module tests/channels.js
scripts/run-tests.sh v8-src/v8/out/release/d8          # every test once
scripts/test-variants.sh v8-src/v8/out/release/d8      # the tests under flag variants, takes hours
```

`scripts/setup.sh tsan is_tsan=true` builds d8 with other gn args in `out/tsan`; `JOBS=8` limits the number of parallel build jobs on machines with little memory.

The documentation is on the [site](https://tom4ikss.github.io/region-js/). The site is built from `site/` (Astro and Starlight, needs Node 22 and pnpm):

```sh
cd site
pnpm install
pnpm dev                             # http://localhost:4321/region-js/
pnpm build && pnpm check             # the static site in site/dist, then a check of links and anchors
node scripts/run-examples.mjs        # rerun the examples in d8 and update their output (*.out.txt)
```

The playground: open the `playground/` folder in VSCode and run `npm install`; Cmd+Shift+B runs the open file. More in `playground/README.md`.

## What is where

| Folder | Contents |
|---|---|
| `v8/regions.patch` | The fork itself: a patch on top of V8 `v8/BASE`, build flags in `v8/args.gn` |
| `site/` | The documentation site: pages in `site/src/content/docs` (English at the root, Russian in `ru/`), examples with saved output in `site/examples/en` and `site/examples/ru` |
| `tests/` | Tests and benchmarks for regions, `spawn`, channels and `free()`, a fuzzer |
| `playground/` | Types, Biome, the ESLint plugin and examples for VSCode |
| `prototype/js-ownership/` | The first version of the idea in plain JS on top of `SharedArrayBuffer` |
| `DESIGN.md` | The design and how much of it is implemented (in Russian) |

## Status

Alpha. V8's own tests (mjsunit, 9,255) pass, and so do our tests and the fuzzer, but this is a research prototype: it has had no security review on the level of real V8, so do not run untrusted code in it. What is missing and why is on the [Limits and plans](https://tom4ikss.github.io/region-js/limits/) page (`site/src/content/docs/limits.mdx`).

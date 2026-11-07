# Real-world HTTP benchmark

The same API in every server, with a real database, so that frameworks and
runtimes are compared on work that looks like a web service and not on a route
tuned for regions. The routes are described at the top of `common.js`:

- `/plaintext`, `/json`, `/db`, `/queries?n=20`, `/fortunes`, `/updates?n=20`:
  the TechEmpower tests;
- `/search`: a product search over a catalog of 1,000,000 rows held in memory
  (filter, sort, page);
- `/report`: an aggregate over 5,000 products (buckets, a `Map` of brands, a
  sort), a few milliseconds of CPU.

Every server loads the catalog from Postgres at startup. In the process-based
variants each process holds its own copy; in the region variants all threads
share one sealed region; Go and Rust share one copy between their threads.

| Variant | What runs |
|---|---|
| `express` | Express 5 in 8 `node:cluster` processes |
| `fastify` | Fastify 5 in 8 `node:cluster` processes |
| `http` | `node:http` without a framework (`raw.js`) in 8 processes |
| `uws` | uWebSockets.js (`raw.js`) in 8 processes |
| `bun` | `Bun.serve` with `reusePort` in 8 processes, `Bun.sql` |
| `go` | `net/http` and pgx, `GOMAXPROCS=8` |
| `rust` | axum on 8 tokio workers, tokio-postgres |
| `regions-http` | `raw.js` on `node:http` in 8 `spawn()` threads of one process |
| `regions-uws` | `raw.js` on uWebSockets.js in 8 `spawn()` threads of one process |

The Node variants use postgres.js. Every process or thread has a pool of 8
database connections; Go and Rust have one pool of 64. A suffix `@rjs` runs a
Node variant on the Node built from this fork instead of the stock one, to
separate the engine from the architecture.

## Setup

On Linux x64:

- Postgres on 127.0.0.1 with a database `bench` owned by the role `bench`
  (password `bench`), filled by `psql -h 127.0.0.1 -U bench bench -f db.sql`;
- `npm install` here; Node, Bun, `wrk` and [wrk2](https://github.com/giltene/wrk2);
- `go build -o go-server .` in `go/` and `cargo build --release` in `rust/`;
- the Node of this fork (`scripts/setup-node.sh`, a release build) as `FORK_NODE`;
- for `uws` and `regions-uws`, uWebSockets.js built from source against the
  headers of that Node. Its addon has to be compiled with the same V8 defines
  as the Node (`-DV8_COMPRESS_POINTERS -DV8_COMPRESS_POINTERS_IN_SHARED_CAGE
  -DV8_31BIT_SMIS_ON_64BIT_ARCH`), otherwise it crashes on the first call. It
  needs a few changes for the V8 15.9 embedder API: tags for `External` and
  aligned pointers in internal fields, and `DataV2()` instead of `Data()`.
  `UWS` is the path of its `index.js`.

Pin Postgres to cores of its own, so that it does not compete with the server
or with wrk:

```sh
for p in $(pgrep postgres); do sudo taskset -apc 8-15 $p; done
```

## Running

```sh
NODE=... FORK_NODE=... BUN=... UWS=... WRK2=... python3 run.py
ROUTES=json,search python3 run.py fastify regions-uws
MIX=search=20000,report=1000 python3 run.py fastify bun regions-uws
```

The server runs on cores 0-7 (`SERVER_CPUS`), wrk on 16-31 (`LOAD_CPUS`).
Without `MIX`, each route gets a warm-up and then a run of `wrk` with 256
connections, which measures the most a server can do. With `MIX`, every route
of `MIX` gets its own `wrk2` at a fixed rate at the same time, and each
reports its own latency: how long light requests wait while heavy ones run
next to them.

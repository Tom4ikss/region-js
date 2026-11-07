// bun bun.js [processes] [port]
// Bun.serve in `processes` processes on one port (reusePort: the kernel
// spreads the connections), with Bun.sql. Each process has its own database
// pool (DB_POOL connections, 8 by default) and its own copy of the catalog.
// Prints `ready` once every process listens.
const common = require('./common');

const processes = Number(process.argv[2] ?? 8);
const port = Number(process.argv[3] ?? 3000);
const pool = Number(process.env.DB_POOL ?? 8);

const json = (value) => Response.json(value);

async function worker() {
  const { SQL } = require('bun');
  const sql = new SQL({ ...common.DB, max: pool });
  const catalog = common.buildCatalog(await common.loadProducts(sql));
  const db = common.database(sql);
  const query = (url) => Object.fromEntries(new URL(url).searchParams);
  Bun.serve({
    port,
    hostname: '127.0.0.1',
    reusePort: true,
    routes: {
      '/plaintext': () => new Response('Hello, World!', { headers: { 'Content-Type': 'text/plain' } }),
      '/json': () => json({ message: 'Hello, World!' }),
      '/db': async () => json(await db.one()),
      '/queries': async (req) => json(await db.many(common.count(query(req.url).n))),
      '/fortunes': async () => new Response(await db.fortunes(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
      '/updates': async (req) => json(await db.updates(common.count(query(req.url).n))),
      '/search': (req) => json(common.search(catalog, query(req.url))),
      '/report': (req) => json(common.report(catalog, query(req.url))),
    },
    fetch: () => new Response('Not Found', { status: 404 }),
  });
  process.send?.('listening');
}

if (process.env.BENCH_WORKER) {
  worker().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  let listening = 0;
  const children = [];
  for (let i = 0; i < processes; i++) {
    children.push(Bun.spawn([process.execPath, import.meta.path, String(processes), String(port)], {
      env: { ...process.env, BENCH_WORKER: '1' },
      stdio: ['inherit', 'inherit', 'inherit'],
      ipc() {
        if (++listening === processes) console.log('ready');
      },
    }));
  }
  const stop = () => {
    for (const child of children) child.kill();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

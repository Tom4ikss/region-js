// node --harmony-regions regions.js <http|uws> [threads] [port]
// The routes of raw.js in `threads` spawn() threads of one process, each with
// its own server on the port (node:http with reusePort, or uWebSockets.js,
// whose index.js is at UWS) and its own database pool (DB_POOL connections, 8
// by default). The catalog is loaded once and shared by all threads as one
// sealed region. Prints `ready` once every thread listens.
'use strict';
const common = require('./common');

const mode = process.argv[2];
const threads = Number(process.argv[3] ?? 8);
const port = Number(process.argv[4] ?? 3000);
const pool = Number(process.env.DB_POOL ?? 8);

async function main() {
  const sql = require('postgres')({ ...common.DB, max: 4 });
  const catalog = Region.share(common.buildCatalog(await common.loadProducts(sql)));
  await sql.end();

  spawn.poolSize = threads;
  // The tasks wait on `go` until all of them have started, so that each pool
  // worker gets one (see tests/node/http/rhttp.js).
  const started = new Channel(threads);
  const go = new Channel();
  const listening = new Channel(threads);
  const stop = new Channel();
  const tasks = [];
  for (let i = 0; i < threads; i++) {
    tasks.push(spawn(async (catalog, index, dir, mode, port, pool, uwsPath) => {
      started.sendSync(index);
      go.recvSync();
      const load = process.getBuiltinModule('node:module').createRequire(dir + '/regions.js');
      const common = load('./common');
      const raw = load('./raw');
      const sql = load('postgres')({ ...common.DB, max: pool });
      const db = common.database(sql);
      const server = mode === 'uws'
        ? await raw.uws({ db, catalog, port, uWS: load(uwsPath) })
        : await raw.http({ db, catalog, port, reusePort: true });
      await listening.send(index);
      await stop.recv();
      server.close();
      await sql.end();
    }, catalog, i, __dirname, mode, port, pool, process.env.UWS ?? ''));
  }
  for (let i = 0; i < threads; i++) await started.recv();
  go.close();
  const failed = Promise.race(tasks).then(() => {
    throw new Error('a server thread ended before listening');
  });
  for (let i = 0; i < threads; i++) await Promise.race([listening.recv(), failed]);
  console.log('ready');
  process.once('SIGTERM', async () => {
    stop.close();
    await Promise.allSettled(tasks);
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

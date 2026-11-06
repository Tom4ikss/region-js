// node [--harmony-regions] server.js <variant> [threads] [port]
//
// One HTTP API in five variants, for run.py:
//   fastify          Fastify on one thread
//   fastify-cluster  Fastify in `threads` processes (node:cluster), each with
//                    its own copy of the catalog
//   fastify-piscina  Fastify on the main thread; /compute and /catalog run in
//                    a piscina pool of `threads` workers, each with its own
//                    copy of the catalog
//   fastify-spawn    Fastify on the main thread; /compute and /catalog run in
//                    spawn() tasks, the catalog is one sealed region
//   rhttp            rhttp.js: `threads` threads, each with its own server on
//                    the port, the catalog is one sealed region
//
// Routes: /hello, /compute?seed=N (about half a millisecond of CPU) and
// /catalog?c=N (a query over one category of the catalog). CATALOG_ROWS sets
// the size of the catalog (1,000,000 rows by default). Prints `ready <ms>`
// once every thread or process listens.
'use strict';
const cluster = require('node:cluster');
const path = require('node:path');
const { buildCatalog, query, compute } = require('./work');

const variant = process.argv[2];
const threads = Number(process.argv[3] ?? 8);
const port = Number(process.argv[4] ?? 3000);
const rows = Number(process.env.CATALOG_ROWS ?? 1e6);

function ready() {
  console.log('ready %d', Math.round(performance.now()));
}

async function fastify(routes) {
  const app = require('fastify')({ logger: false });
  app.get('/hello', async () => ({ hello: 'world' }));
  app.get('/compute', (request) => routes.compute(Number(request.query.seed)));
  app.get('/catalog', (request) => routes.catalog(Number(request.query.c)));
  await app.listen({ port, host: '0.0.0.0' });
  return app;
}

async function main() {
  switch (variant) {
    case 'fastify': {
      const catalog = buildCatalog(rows);
      await fastify({
        compute: async (seed) => compute(seed),
        catalog: async (c) => query(catalog, c),
      });
      ready();
      break;
    }
    case 'fastify-cluster': {
      if (cluster.isPrimary) {
        let listening = 0;
        cluster.on('listening', () => { if (++listening === threads) ready(); });
        for (let i = 0; i < threads; i++) cluster.fork();
        break;
      }
      const catalog = buildCatalog(rows);
      await fastify({
        compute: async (seed) => compute(seed),
        catalog: async (c) => query(catalog, c),
      });
      break;
    }
    case 'fastify-piscina': {
      const { Piscina } = require('piscina');
      const pool = new Piscina({
        filename: path.join(__dirname, 'piscina-worker.js'),
        minThreads: threads,
        maxThreads: threads,
        env: { ...process.env, CATALOG_ROWS: String(rows) },
      });
      await Promise.all(Array.from({ length: threads }, () => pool.run({ route: 'ping' })));
      await fastify({
        compute: (seed) => pool.run({ route: 'compute', arg: seed }),
        catalog: (c) => pool.run({ route: 'catalog', arg: c }),
      });
      ready();
      break;
    }
    case 'fastify-spawn': {
      spawn.poolSize = threads;
      const catalog = Region.share(buildCatalog(rows));
      await Promise.all(Array.from({ length: threads }, () => spawn(() => 0)));
      await fastify({
        compute: (seed) => spawn((seed) => compute(seed), seed),
        catalog: (c) => spawn((catalog, c) => query(catalog, c), catalog, c),
      });
      ready();
      break;
    }
    case 'rhttp': {
      const { serve } = require('./rhttp');
      const catalog = Region.share(buildCatalog(rows));
      const server = await serve({ port, threads, state: catalog }, (router, catalog) => {
        router.get('/hello', () => ({ hello: 'world' }));
        router.get('/compute', (params) => compute(Number(params.get('seed'))));
        router.get('/catalog', (params) => query(catalog, Number(params.get('c'))));
      });
      ready();
      process.once('SIGTERM', async () => {
        const served = await server.close();
        console.log('served %j connections %j', served.map((s) => s.requests),
                    served.map((s) => s.connections));
      });
      break;
    }
    default:
      console.error('unknown variant %s', variant);
      process.exit(2);
  }
}

main();

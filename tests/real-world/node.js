// node node.js <express|fastify|http|uws> [processes] [port]
// Express, Fastify, plain node:http or uWebSockets.js (raw.js; UWS is the
// path of its index.js) in `processes` processes of node:cluster. Each process
// has its own database pool (DB_POOL connections, 8 by default) and its own
// copy of the catalog. Prints `ready` once every process listens.
'use strict';
const cluster = require('node:cluster');
const common = require('./common');

const framework = process.argv[2];
const processes = Number(process.argv[3] ?? 8);
const port = Number(process.argv[4] ?? 3000);
const pool = Number(process.env.DB_POOL ?? 8);

async function express(db, catalog) {
  const app = require('express')();
  app.disable('etag');
  app.disable('x-powered-by');
  app.get('/plaintext', (req, res) => res.type('text/plain').send('Hello, World!'));
  app.get('/json', (req, res) => res.json({ message: 'Hello, World!' }));
  app.get('/db', async (req, res) => res.json(await db.one()));
  app.get('/queries', async (req, res) => res.json(await db.many(common.count(req.query.n))));
  app.get('/fortunes', async (req, res) => res.type('text/html; charset=utf-8').send(await db.fortunes()));
  app.get('/updates', async (req, res) => res.json(await db.updates(common.count(req.query.n))));
  app.get('/search', (req, res) => res.json(common.search(catalog, req.query)));
  app.get('/report', (req, res) => res.json(common.report(catalog, req.query)));
  await new Promise((resolve) => app.listen(port, '127.0.0.1', resolve));
}

async function fastify(db, catalog) {
  const app = require('fastify')({ logger: false });
  app.get('/plaintext', (request, reply) => reply.type('text/plain').send('Hello, World!'));
  app.get('/json', async () => ({ message: 'Hello, World!' }));
  app.get('/db', () => db.one());
  app.get('/queries', (request) => db.many(common.count(request.query.n)));
  app.get('/fortunes', async (request, reply) => reply.type('text/html; charset=utf-8').send(await db.fortunes()));
  app.get('/updates', (request) => db.updates(common.count(request.query.n)));
  app.get('/search', async (request) => common.search(catalog, request.query));
  app.get('/report', async (request) => common.report(catalog, request.query));
  await app.listen({ port, host: '127.0.0.1' });
}

async function main() {
  if (cluster.isPrimary) {
    let listening = 0;
    cluster.on('message', (w, message) => {
      if (message === 'listening' && ++listening === processes) console.log('ready');
    });
    for (let i = 0; i < processes; i++) cluster.fork();
    return;
  }
  const sql = require('postgres')({ ...common.DB, max: pool });
  const catalog = common.buildCatalog(await common.loadProducts(sql));
  const db = common.database(sql);
  const raw = require('./raw');
  switch (framework) {
    case 'express': await express(db, catalog); break;
    case 'fastify': await fastify(db, catalog); break;
    case 'http': await raw.http({ db, catalog, port }); break;
    case 'uws': await raw.uws({ db, catalog, port, uWS: require(process.env.UWS) }); break;
    default: throw new Error('unknown framework ' + framework);
  }
  process.send('listening');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

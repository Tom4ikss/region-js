// The routes on node:http and on uWebSockets.js without a framework, for the
// node.js variants http and uws (in cluster processes) and for regions.js (in
// spawn() threads). `db` is common.database(), `catalog` is common.buildCatalog()
// or a sealed region with the same data.
'use strict';
const common = require('./common');

function split(url) {
  const q = url.indexOf('?');
  if (q < 0) return [url, {}];
  return [url.slice(0, q), Object.fromEntries(new URLSearchParams(url.slice(q + 1)))];
}

// Returns [content type, body] for a route, or a promise of it, or undefined.
function route(path, query, db, catalog) {
  switch (path) {
    case '/plaintext': return ['text/plain', 'Hello, World!'];
    case '/json': return ['application/json', JSON.stringify({ message: 'Hello, World!' })];
    case '/db': return db.one().then((row) => ['application/json', JSON.stringify(row)]);
    case '/queries': return db.many(common.count(query.n)).then((rows) => ['application/json', JSON.stringify(rows)]);
    case '/fortunes': return db.fortunes().then((html) => ['text/html; charset=utf-8', html]);
    case '/updates': return db.updates(common.count(query.n)).then((rows) => ['application/json', JSON.stringify(rows)]);
    case '/search': return ['application/json', JSON.stringify(common.search(catalog, query))];
    case '/report': return ['application/json', JSON.stringify(common.report(catalog, query))];
    default: return undefined;
  }
}

function http({ db, catalog, port, reusePort = false }) {
  const server = require('node:http').createServer((req, res) => {
    const [path, query] = split(req.url);
    const reply = ([type, body]) => {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };
    const fail = (e) => {
      res.writeHead(500);
      res.end(String(e));
    };
    let result;
    try {
      result = route(path, query, db, catalog);
    } catch (e) {
      return fail(e);
    }
    if (result === undefined) {
      res.writeHead(404);
      res.end();
    } else if (Array.isArray(result)) {
      reply(result);
    } else {
      result.then(reply, fail);
    }
  });
  return new Promise((resolve) => server.listen({ port, host: '127.0.0.1', reusePort }, () => resolve(server)));
}

function uws({ db, catalog, port, uWS }) {
  const app = uWS.App();
  const send = (res, [type, body]) => res.cork(() => {
    res.writeHeader('Content-Type', type).end(body);
  });
  app.any('/*', (res, req) => {
    const path = req.getUrl();
    const raw = req.getQuery();
    const query = raw ? Object.fromEntries(new URLSearchParams(raw)) : {};
    let result;
    try {
      result = route(path, query, db, catalog);
    } catch (e) {
      res.writeStatus('500 Internal Server Error').end(String(e));
      return;
    }
    if (result === undefined) {
      res.writeStatus('404 Not Found').end();
    } else if (Array.isArray(result)) {
      send(res, result);
    } else {
      let aborted = false;
      res.onAborted(() => { aborted = true; });
      result.then((r) => { if (!aborted) send(res, r); }, (e) => {
        if (!aborted) res.cork(() => res.writeStatus('500 Internal Server Error').end(String(e)));
      });
    }
  });
  return new Promise((resolve, reject) => app.listen('127.0.0.1', port, (token) => {
    if (token) resolve(app);
    else reject(new Error('uWS could not listen on ' + port));
  }));
}

module.exports = { split, route, http, uws };

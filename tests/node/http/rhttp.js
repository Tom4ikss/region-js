// rhttp: a small HTTP framework on spawn() and channels, for the benchmark.
//
//   const { serve } = require('./rhttp');
//   const server = await serve({ port: 3000, threads: 8, state }, (router, state) => {
//     router.get('/hello', () => ({ hello: 'world' }));
//     router.get('/item', (query) => state.items[Number(query.get('id'))]);
//   });
//   await server.close();
//
// Every thread runs its own HTTP server on the same port (SO_REUSEPORT: the
// kernel spreads the connections), so there is no main thread that all
// requests pass through. The threads are spawn() tasks, one per pool worker.
// The app function travels to each of them the way spawn() sends any
// captured function: as source text, together with what it captures. `state`
// is shared by all threads without a copy: pass a frozen or sealed region
// (Region.share). A handler returns an object, which is sent as JSON.
'use strict';

async function serve({ port, threads, state }, app) {
  spawn.poolSize = threads;
  // The tasks wait on `go` until all of them have started, so that each pool
  // worker gets one: a task waiting in `await` frees its worker for the next
  // task, and two servers would end up on one thread.
  const started = new Channel(threads);
  const go = new Channel();
  const listening = new Channel(threads);
  const stop = new Channel();
  const tasks = [];
  for (let i = 0; i < threads; i++) {
    tasks.push(spawn(async (state, index) => {
      started.sendSync(index);
      go.recvSync();

      const http = process.getBuiltinModule('node:http');
      const routes = new Map();
      app({ get(path, handler) { routes.set(path, handler); } }, state);

      let requests = 0;
      let connections = 0;
      const server = http.createServer((req, res) => {
        requests++;
        const url = req.url;
        const mark = url.indexOf('?');
        const handler = routes.get(mark === -1 ? url : url.slice(0, mark));
        if (handler === undefined) {
          res.writeHead(404).end();
          return;
        }
        let body;
        try {
          body = JSON.stringify(handler(new URLSearchParams(mark === -1 ? '' : url.slice(mark + 1))));
        } catch (error) {
          res.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
          return;
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
        }).end(body);
      });
      server.on('connection', () => { connections++; });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port, reusePort: true }, resolve);
      });
      await listening.send(index);

      // A closed `stop` ends the server.
      await stop.recv();
      server.close();
      server.closeAllConnections();
      return { index, requests, connections };
    }, state, i));
  }
  for (let i = 0; i < threads; i++) await started.recv();
  go.close();
  const ended = Promise.race(tasks).then(() => {
    throw new Error('a server thread ended before listening');
  });
  ended.catch(() => {});
  for (let i = 0; i < threads; i++) await Promise.race([listening.recv(), ended]);
  return {
    tasks,
    // Stops every thread and returns how many requests and connections each
    // one served.
    async close() {
      stop.close();
      return Promise.all(tasks);
    },
  };
}

module.exports = { serve };

// d8 --harmony-regions --module bench-channels.js
// Round trips main <-> task through channels, against postMessage.
const N = Number(globalThis.arguments?.[0] ?? 20000);
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];

async function channelRoundTrips(blockingTask) {
  const ping = new Channel();
  const pong = new Channel();
  const task = blockingTask
      ? spawn(() => { for (const n of ping) pong.sendSync(n + 1); })
      : spawn(async () => { for await (const n of ping) await pong.send(n + 1); });
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    await ping.send(i);
    await pong.recv();
  }
  const perTrip = (performance.now() - start) * 1000 / N;
  ping.close();
  await task;
  return perTrip;
}

function blockingBothSides(capacity = 0) {
  const ping = new Channel(capacity);
  const pong = new Channel(capacity);
  const task = spawn(() => { for (const n of ping) pong.sendSync(n + 1); });
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    ping.sendSync(i);
    pong.recvSync();
  }
  const perTrip = (performance.now() - start) * 1000 / N;
  ping.close();
  task.join();
  return perTrip;
}

function postMessageRoundTrips() {
  const w = new Worker('onmessage = ({ data }) => postMessage(data + 1);', { type: 'string' });
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    w.postMessage(i);
    w.getMessage();
  }
  const perTrip = (performance.now() - start) * 1000 / N;
  w.terminate();
  return perTrip;
}

async function regionRoundTrips() {
  const ping = new Channel();
  const pong = new Channel();
  const task = spawn(() => { for (const tree of ping) { tree.hits++; pong.sendSync(tree); } });
  let tree = new Region().run(() => ({ hits: 0, nodes: Array.from({ length: 1000 }, (_, i) => ({ i })) }));
  const start = performance.now();
  for (let i = 0; i < N / 4; i++) {
    ping.sendSync(tree);
    tree = pong.recvSync().value;
  }
  const perTrip = (performance.now() - start) * 1000 / (N / 4);
  ping.close();
  task.join();
  return [perTrip, tree.hits];
}

const runs = { asyncTask: [], blockingTask: [], blockingBoth: [], buffered: [], postMessage: [], region: [] };
for (let r = 0; r < 5; r++) {
  runs.asyncTask.push(await channelRoundTrips(false));
  runs.blockingTask.push(await channelRoundTrips(true));
  runs.blockingBoth.push(blockingBothSides());
  runs.buffered.push(blockingBothSides(1));
  runs.postMessage.push(postMessageRoundTrips());
  const [perTrip, hits] = await regionRoundTrips();
  runs.region.push(perTrip);
  if (hits !== N / 4) print('region lost hits:', hits);
}
print('round trip, µs (median of 5):');
print('  channels, async on both sides:         ', median(runs.asyncTask).toFixed(1));
print('  channels, main async, task blocking:   ', median(runs.blockingTask).toFixed(1));
print('  channels, blocking on both sides:      ', median(runs.blockingBoth).toFixed(1));
print('  channels of capacity 1, blocking:      ', median(runs.buffered).toFixed(1));
print('  postMessage + getMessage:              ', median(runs.postMessage).toFixed(1));
print('  channels, 1000-node region moved there and back:', median(runs.region).toFixed(1));

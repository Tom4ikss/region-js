// d8 --harmony-regions --module bench-tasks.js -- [poolSize]
// A thousand tasks five ways; tests/tokio-bench runs the same in Rust with
// tokio. Prints the best and the median of five runs.
const N = 1000;
spawn.poolSize = Number(globalThis.arguments?.[0] ?? 4);
const busy = (us) => {
  const end = performance.now() + us / 1000;
  let x = 0;
  while (performance.now() < end) x++;
  return x;
};
const time = async (name, fn, reps = 5) => {
  const runs = [];
  for (let i = 0; i < reps; i++) {
    const start = performance.now();
    await fn();
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  print(`${name}: ${runs[0].toFixed(2)} ms best, ${runs[reps >> 1].toFixed(2)} ms median`);
};

// Start the workers.
await Promise.all(Array.from({ length: 64 }, (_, i) => spawn((i) => i, i)));

await time('spawn+await 1000 trivial', () =>
  Promise.all(Array.from({ length: N }, (_, i) => spawn((i) => i + 1, i))));

await time('1000 x 50us cpu', () =>
  Promise.all(Array.from({ length: N }, () => spawn(() => busy(50)))));

await time('fan-in: 1000 tasks send, main recv', async () => {
  const ch = new Channel(N);
  const tasks = Array.from({ length: N }, (_, i) => spawn(async (ch, i) => {
    await ch.send(i);
  }, ch, i));
  for (let i = 0; i < N; i++) await ch.recv();
  await Promise.all(tasks);
});

await time('1000 parked on recv, then woken', async () => {
  const inbox = new Channel(N);
  const out = new Channel(N);
  const tasks = Array.from({ length: N }, () => spawn(async (inbox, out) => {
    const { value } = await inbox.recv();
    await out.send(value * 2);
  }, inbox, out));
  for (let i = 0; i < N; i++) await inbox.send(i);
  for (let i = 0; i < N; i++) await out.recv();
  await Promise.all(tasks);
});

await time('ping-pong 1000 round trips', async () => {
  const ping = new Channel(), pong = new Channel();
  const task = spawn(async (ping, pong) => {
    for await (const v of ping) await pong.send(v);
  }, ping, pong);
  for (let i = 0; i < N; i++) {
    await ping.send(i);
    await pong.recv();
  }
  ping.close();
  await task;
});

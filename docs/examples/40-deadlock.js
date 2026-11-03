// d8-flags: --module
// A deadlock: all threads are waiting, and none of them can wake the others.
const ping = new Channel();
const pong = new Channel();

// Both tasks wait first and send later: this exchange never starts.
const a = spawn(async (ping, pong) => {
  await ping.recv();
  await pong.send('from a');
}, ping, pong);
const b = spawn(async (ping, pong) => {
  await pong.recv();
  await ping.send('from b');
}, ping, pong);

for (const [name, task] of [['a', a], ['b', b]]) {
  try {
    await task;
  } catch (e) {
    print(`task ${name}: ${e.name}: ${e.message}`);
  }
}

// The error can be caught, and the program can go on.
const lonely = new Channel(1);
try {
  await lonely.recv();
} catch (e) {
  print('main thread:', e.name);
}
await lonely.send('now there is something to receive');
print((await lonely.recv()).value);

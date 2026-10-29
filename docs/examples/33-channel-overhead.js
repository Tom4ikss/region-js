// d8-flags: --module
// Сколько стоит один круг «туда и обратно» через два канала без буфера.
const N = 5000;
const ping = new Channel();
const pong = new Channel();
const echo = spawn(() => {
  for (const n of ping) pong.sendSync(n + 1);
});

const start = performance.now();
for (let i = 0; i < N; i++) {
  ping.sendSync(i);
  pong.recvSync();
}
const perTrip = (performance.now() - start) * 1000 / N;
ping.close();
await echo;

const worker = new Worker('onmessage = ({ data }) => postMessage(data + 1);', { type: 'string' });
const t = performance.now();
for (let i = 0; i < N; i++) {
  worker.postMessage(i);
  worker.getMessage();
}
const perMessage = (performance.now() - t) * 1000 / N;
worker.terminate();
print('канал, круг:', perTrip.toFixed(1), 'µs');
print('postMessage + getMessage, круг:', perMessage.toFixed(1), 'µs');

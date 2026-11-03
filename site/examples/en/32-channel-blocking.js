// d8-flags: --module
// A worker can wait blocking: for...of over a channel and sendSync.
// The channel itself is sent to the worker with postMessage.
const numbers = new Channel();
const sums = new Channel(1);
const worker = new Worker(`
  onmessage = ({ data: { numbers, sums } }) => {
    let total = 0;
    for (const n of numbers) total += n;   // waits until the channel is closed
    sums.sendSync(total);
  };`, { type: 'string' });
worker.postMessage({ numbers, sums });

for (let i = 1; i <= 100; i++) await numbers.send(i);
numbers.close();
print('sum from the worker:', (await sums.recv()).value);
worker.terminate();

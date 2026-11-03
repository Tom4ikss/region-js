// d8-flags: --module
// В воркере можно ждать блокирующе: for...of по каналу и sendSync.
// Сам канал отправлен воркеру через postMessage.
const numbers = new Channel();
const sums = new Channel(1);
const worker = new Worker(`
  onmessage = ({ data: { numbers, sums } }) => {
    let total = 0;
    for (const n of numbers) total += n;   // ждёт, пока канал не закроют
    sums.sendSync(total);
  };`, { type: 'string' });
worker.postMessage({ numbers, sums });

for (let i = 1; i <= 100; i++) await numbers.send(i);
numbers.close();
print('сумма от воркера:', (await sums.recv()).value);
worker.terminate();

// Переезд региона в воркер: отправитель теряет доступ, получатель становится владельцем.
// В d8 worker.getMessage() блокирует поток до ответа. В браузере здесь был бы onmessage.
const region = new Region();
const order = region.run(() => ({ id: 17, status: 'new', lines: [120, 80] }));

const worker = new Worker(
  `
  onmessage = ({ data: { order } }) => {
    order.status = 'paid';                       // воркер теперь владелец и может писать
    const total = order.lines[0] + order.lines[1];
    postMessage('воркер: ' + order.status + ', сумма ' + total);
  };
  `,
  { type: 'string' },
);

worker.postMessage({ order }, [region]); // регион в transfer list = переезд

try {
  print(order.status);
} catch (e) {
  print('главный поток:', e.message);
}
print(worker.getMessage());

try {
  order.status = 'cancelled';
} catch (e) {
  print('главный поток пишет:', e.message);
}
try {
  Object.keys(order); // перечисление ключей и JSON.stringify проверяют владельца так же
} catch (e) {
  print('главный поток, Object.keys:', e.message);
}
print('владелец региона теперь isolate', region.owner);
worker.terminate();

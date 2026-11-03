// A region moves to a worker: the sender loses access, the receiver becomes the owner.
// In d8 worker.getMessage() blocks the thread until the reply. In a browser this would be onmessage.
const region = new Region();
const order = region.run(() => ({ id: 17, status: 'new', lines: [120, 80] }));

const worker = new Worker(
  `
  onmessage = ({ data: { order } }) => {
    order.status = 'paid';                       // the worker is now the owner and can write
    const total = order.lines[0] + order.lines[1];
    postMessage('worker: ' + order.status + ', total ' + total);
  };
  `,
  { type: 'string' },
);

worker.postMessage({ order }, [region]); // region in the transfer list = move

try {
  print(order.status);
} catch (e) {
  print('main thread:', String(e));
}
print(worker.getMessage());

try {
  order.status = 'cancelled';
} catch (e) {
  print('main thread writes:', String(e));
}
try {
  Object.keys(order); // key enumeration and JSON.stringify check the owner the same way
} catch (e) {
  print('main thread, Object.keys:', String(e));
}
print('the region owner is now isolate', region.owner);
worker.terminate();

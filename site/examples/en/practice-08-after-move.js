// Practice 8. Do not use an object after its region has moved away.
const region = new Region();
const cart = region.run(() => ({ items: [120, 80], total: 200 }));

// Bad: we send it to a task and read it right away.
const task = spawn(() => {
  cart.total = cart.items[0] + cart.items[1] + 50; // shipping
  return cart.total;
});
try {
  print('right after spawn:', cart.total);
} catch (e) {
  print('right after spawn:', String(e));
}

// Good: wait for the task. The region is back, and the object is the same.
(async () => {
  print('task result:', await task);
  print('after await:', cart.total);

  // Same with a worker: after postMessage(..., [region]) we do not touch the object
  // until the worker sends it back.
  const worker = new Worker(
    `onmessage = ({ data: { cart } }) => {
       cart.total -= 20; // discount
       postMessage({ cart }, [Region.of(cart)]);
     };`,
    { type: 'string' },
  );
  worker.postMessage({ cart }, [region]);
  try {
    cart.total = 0;
  } catch (e) {
    print('write after postMessage:', String(e));
  }
  const back = worker.getMessage().cart;
  print('the same object came back:', back === cart, '| total =', cart.total);
  worker.terminate();
})();

// Практика 8. Не пользоваться объектом после того, как его регион уехал.
const region = new Region();
const cart = region.run(() => ({ items: [120, 80], total: 200 }));

// Плохо: отправили задаче и тут же читаем.
const task = spawn(() => {
  cart.total = cart.items[0] + cart.items[1] + 50; // доставка
  return cart.total;
});
try {
  print('сразу после spawn:', cart.total);
} catch (e) {
  print('сразу после spawn:', e.message);
}

// Хорошо: дождаться задачи. Регион вернулся, объект тот же.
(async () => {
  print('результат задачи:', await task);
  print('после await:', cart.total);

  // С воркером то же самое: после postMessage(..., [region]) объект не трогаем,
  // пока воркер не вернёт его.
  const worker = new Worker(
    `onmessage = ({ data: { cart } }) => {
       cart.total -= 20; // скидка
       postMessage({ cart }, [Region.of(cart)]);
     };`,
    { type: 'string' },
  );
  worker.postMessage({ cart }, [region]);
  try {
    cart.total = 0;
  } catch (e) {
    print('запись после postMessage:', e.message);
  }
  const back = worker.getMessage().cart;
  print('вернулся тот же объект:', back === cart, '| total =', cart.total);
  worker.terminate();
})();

// d8-flags: --module
// Билет borrow() в задаче живёт не дольше самой задачи.
spawn.poolSize = 1;
const region = new Region();
const prices = region.run(() => ({ apple: 50 }));
region.freeze();

// Плохо: голый borrow, а чтение отложено на потом.
await spawn(() => {
  const ticket = Region.of(prices).borrow();
  const later = () => {
    // В d8 setTimeout не ждёт задержку, поэтому явно ждём, пока главный поток разморозит.
    if (Region.of(prices).frozen) return setTimeout(later, 0);
    try {
      print('задача читает позже:', prices.apple);
    } catch (e) {
      print('задача читает позже:', e.message);
    }
    ticket.release();
  };
  setTimeout(later, 0);
});
print('readers после задачи:', region.readers);
region.thaw();
prices.apple = 55;
print('главный поток разморозил и записал:', prices.apple);
await spawn(() => {}); // дать задаче из пула допечатать

// Хорошо: borrowWhile держит билет, пока не выполнится промис, и его ждёт задача.
region.freeze();
const seen = await spawn(() =>
  Region.of(prices).borrowWhile(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return prices.apple + ' (readers: ' + Region.of(prices).readers + ')';
  }),
);
print('borrowWhile:', seen, '| readers после задачи:', region.readers);
region.thaw();

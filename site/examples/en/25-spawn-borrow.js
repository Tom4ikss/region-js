// d8-flags: --module
// A borrow() taken in a task lives no longer than the task itself.
spawn.poolSize = 1;
const region = new Region();
const prices = region.run(() => ({ apple: 50 }));
region.freeze();

// Bad: a bare borrow, with the read put off until later.
await spawn(() => {
  const ticket = Region.of(prices).borrow();
  const later = () => {
    // In d8 setTimeout does not wait for the delay, so wait explicitly until the main thread thaws.
    if (Region.of(prices).frozen) return setTimeout(later, 0);
    try {
      print('the task reads later:', prices.apple);
    } catch (e) {
      print('the task reads later:', String(e));
    }
    ticket.release();
  };
  setTimeout(later, 0);
});
print('readers after the task:', region.readers);
region.thaw();
prices.apple = 55;
print('the main thread thawed and wrote:', prices.apple);
await spawn(() => {}); // let the pool task finish printing

// Good: borrowWhile holds the borrow until the promise settles, and the task waits for it.
region.freeze();
const seen = await spawn(() =>
  Region.of(prices).borrowWhile(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return prices.apple + ' (readers: ' + Region.of(prices).readers + ')';
  }),
);
print('borrowWhile:', seen, '| readers after the task:', region.readers);
region.thaw();

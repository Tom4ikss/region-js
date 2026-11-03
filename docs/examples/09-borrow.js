// borrow(): a reader's "ticket". Until the borrows are released, the region cannot be thawed.
const region = new Region();
const prices = region.run(() => ({ apple: 50, pear: 70 }));
region.freeze();

const ticket = region.borrow();
print('readers:', region.readers);

try {
  region.thaw();
} catch (e) {
  print('thaw with a reader:', String(e));
}

ticket.release();
print('after release, readers:', region.readers);

{
  using scoped = region.borrow(); // released automatically when the block exits
  print('inside the block, readers:', region.readers, '| apple =', prices.apple);
}
print('after the block, readers:', region.readers);

region.thaw();
prices.apple = 55;
print('thawed, apple =', prices.apple);

try {
  new Region().borrow();
} catch (e) {
  print('borrow of an unfrozen region:', String(e));
}

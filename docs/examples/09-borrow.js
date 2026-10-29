// borrow(): «билет читателя». Пока билеты не сданы, регион нельзя разморозить.
const region = new Region();
const prices = region.run(() => ({ apple: 50, pear: 70 }));
region.freeze();

const ticket = region.borrow();
print('readers:', region.readers);

try {
  region.thaw();
} catch (e) {
  print('thaw с читателем:', e.message);
}

ticket.release();
print('после release, readers:', region.readers);

{
  using scoped = region.borrow(); // сдаётся сам при выходе из блока
  print('внутри блока, readers:', region.readers, '| apple =', prices.apple);
}
print('после блока, readers:', region.readers);

region.thaw();
prices.apple = 55;
print('разморожено, apple =', prices.apple);

try {
  new Region().borrow();
} catch (e) {
  print('borrow незамороженного:', e.message);
}

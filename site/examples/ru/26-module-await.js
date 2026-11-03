// d8-flags: --module
// С флагом --module await работает прямо на верхнем уровне файла.
const total = await spawn((n) => {
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += i;
  return sum;
}, 1000);
print('сумма:', total);

// Задачу без await d8 тоже дождётся и только потом завершится.
spawn(() => {
  let x = 0;
  for (let i = 0; i < 30_000_000; i++) x += i;
  print('задача без await закончилась');
});
print('файл выполнен до конца');

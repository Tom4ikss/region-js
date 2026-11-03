// d8-flags: --module
// Задача отвечает только после всех задач, которые запустила сама.
const answer = await spawn(() => {
  spawn(() => {
    let x = 0;
    for (let i = 0; i < 30_000_000; i++) x += i; // долгая вложенная задача
    print('вложенная задача закончилась');
  }); // её никто не ждёт
  print('внешняя задача вернула значение');
  return 'готово';
});
print('главный поток получил:', answer);

// spawn.idle(): дождаться всех задач, которые запустил этот поток.
spawn(() => print('задача без await'));
await spawn.idle();
print('spawn.idle() выполнен');

// У каждого потока свой пул.
spawn.poolSize = 6;
print('poolSize здесь:', spawn.poolSize, '| в задаче:', await spawn(() => spawn.poolSize));

// d8-flags: --module
// Отмена задач: abort(), timeout(ms) и JoinSet.
const outcome = async (task) => {
  try {
    return 'результат ' + (await task);
  } catch (e) {
    return e.name + ': ' + e.message;
  }
};

// Задача ждёт канал, в который никто не напишет.
const never = new Channel();
const stuck = spawn(async (never) => {
  await never.recv();
}, never);
stuck.abort();
print('abort:', await outcome(stuck));

// Тот же случай с таймаутом.
const slow = spawn((never) => never.recvSync(), never).timeout(50);
print('timeout:', await outcome(slow));

// Задача без ожиданий проверяет флаг сама.
const loop = spawn(() => {
  let rounds = 0;
  while (!spawn.aborted()) rounds++;
  return rounds;
});
loop.timeout(20);
print('цикл:', await outcome(loop));

// JoinSet: результаты в порядке завершения.
{
  using set = new JoinSet();
  for (const ms of [80, 10, 40]) {
    set.spawn((ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
      return ms;
    }, ms);
  }
  set.spawn(async (never) => {
    await never.recv();
  }, never);
  for (let i = 0; i < 3; i++) {
    const { value } = await set.next();
    print('готово:', value, 'мс');
  }
  print('осталось задач:', set.size);
}   // выход из блока отменяет оставшуюся задачу

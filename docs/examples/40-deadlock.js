// d8-flags: --module
// Дедлок: все потоки ждут, и разбудить друг друга им некому.
const ping = new Channel();
const pong = new Channel();

// Обе задачи сначала ждут, а отправляют потом: такой обмен не начнётся никогда.
const a = spawn(async (ping, pong) => {
  await ping.recv();
  await pong.send('от a');
}, ping, pong);
const b = spawn(async (ping, pong) => {
  await pong.recv();
  await ping.send('от b');
}, ping, pong);

for (const [name, task] of [['a', a], ['b', b]]) {
  try {
    await task;
  } catch (e) {
    print(`задача ${name}: ${e.name}: ${e.message}`);
  }
}

// Ошибку можно поймать и продолжить.
const lonely = new Channel(1);
try {
  await lonely.recv();
} catch (e) {
  print('главный поток:', e.name);
}
await lonely.send('теперь есть что получить');
print((await lonely.recv()).value);

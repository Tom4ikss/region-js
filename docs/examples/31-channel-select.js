// d8-flags: --module
// select ждёт тот канал, в котором значение появится первым.
const results = new Channel(1);
const errors = new Channel(1);

const task = spawn(async () => {
  try {
    await results.send(JSON.parse('{"ok": true}'));
  } catch (e) {
    await errors.send(e.message);
  }
});

const first = await Channel.select([results, errors]);
print(first.channel === results ? 'результат:' : 'ошибка:', JSON.stringify(first.value));
await task;

// Закрытый канал тоже «готов»: select вернёт его с done: true.
errors.close();
const closed = await Channel.select([results, errors]);
print('закрытый:', closed.channel === errors, closed.done);

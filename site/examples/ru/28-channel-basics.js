// d8-flags: --module
// Канал с буфером на два значения, закрытие и перебор через for await.
const ch = new Channel(2);
await ch.send('первое');
await ch.send({ text: 'второе' });
print('в буфере:', ch.size, 'из', ch.capacity);

const first = await ch.recv();
print('recv:', first.value, first.done);

ch.close();
try {
  await ch.send('третье');
} catch (e) {
  print('send после close:', e.message);
}
// Уже отправленное после close всё равно можно получить.
for await (const value of ch) print('for await:', JSON.stringify(value));
print('после конца:', JSON.stringify(await ch.recv()));

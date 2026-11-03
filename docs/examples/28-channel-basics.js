// d8-flags: --module
// A channel with a buffer for two values, closing it, and reading it with for await.
const ch = new Channel(2);
await ch.send('first');
await ch.send({ text: 'second' });
print('in the buffer:', ch.size, 'of', ch.capacity);

const first = await ch.recv();
print('recv:', first.value, first.done);

ch.close();
try {
  await ch.send('third');
} catch (e) {
  print('send after close:', e.message);
}
// What was already sent can still be received after close.
for await (const value of ch) print('for await:', JSON.stringify(value));
print('after the end:', JSON.stringify(await ch.recv()));

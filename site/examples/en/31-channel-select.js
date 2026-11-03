// d8-flags: --module
// select waits for the channel in which a value appears first.
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
print(first.channel === results ? 'result:' : 'error:', JSON.stringify(first.value));
await task;

// A closed channel is "ready" too: select returns it with done: true.
errors.close();
const closed = await Channel.select([results, errors]);
print('closed:', closed.channel === errors, closed.done);

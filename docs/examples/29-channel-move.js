// d8-flags: --module
// A region sent to a channel moves: the sender no longer has access to it.
const ch = new Channel(1);
const order = new Region().run(() => ({ id: 7, status: 'new', items: ['tea', 'cheese'] }));
await ch.send(order);
try {
  print(order.status);
} catch (e) {
  print('sender after send:', String(e));
}

// The region stays in the channel until someone takes it.
const back = await spawn(async () => {
  const { value: received } = await ch.recv();
  received.status = 'accepted';
  return received;
});
print('back from the task:', back.id, back.status, back.items.join(', '));

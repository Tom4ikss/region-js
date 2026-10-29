// d8-flags: --module
// Регион, отправленный в канал, переезжает: у отправителя доступа больше нет.
const ch = new Channel(1);
const order = new Region().run(() => ({ id: 7, status: 'новый', items: ['чай', 'сыр'] }));
await ch.send(order);
try {
  print(order.status);
} catch (e) {
  print('отправитель после send:', e.message);
}

// Регион лежит в канале, пока его не заберут.
const back = await spawn(async () => {
  const { value: received } = await ch.recv();
  received.status = 'принят';
  return received;
});
print('вернулся из задачи:', back.id, back.status, back.items.join(', '));

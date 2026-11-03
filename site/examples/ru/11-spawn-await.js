// await handle не блокирует главный поток. Колбэк может быть async.
(async () => {
  const heavy = (n) => spawn((n) => {
    let t = 0;
    for (let i = 0; i < n; i++) t = (t + i * i) % 1000003;
    return t;
  }, n);

  const pending = Promise.all([heavy(5_000_000), heavy(6_000_000), heavy(7_000_000)]);
  print('задачи запущены, главный поток свободен');
  const results = await pending;
  print('результаты:', results.join(', '));

  const page = await spawn(async (id) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { id, rows: [1, 2, 3] };
  }, 'page-7');
  print('async-колбэк:', page.id, page.rows.length, 'строки');

  try {
    await spawn(async () => {
      await null;
      throw new RangeError('слишком далеко');
    });
  } catch (e) {
    print('ошибка из потока:', e.name + ':', e.message);
  }
})();

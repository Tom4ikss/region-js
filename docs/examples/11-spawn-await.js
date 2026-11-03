// await handle does not block the main thread. The callback can be async.
(async () => {
  const heavy = (n) => spawn((n) => {
    let t = 0;
    for (let i = 0; i < n; i++) t = (t + i * i) % 1000003;
    return t;
  }, n);

  const pending = Promise.all([heavy(5_000_000), heavy(6_000_000), heavy(7_000_000)]);
  print('tasks started, the main thread is free');
  const results = await pending;
  print('results:', results.join(', '));

  const page = await spawn(async (id) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { id, rows: [1, 2, 3] };
  }, 'page-7');
  print('async callback:', page.id, page.rows.length, 'rows');

  try {
    await spawn(async () => {
      await null;
      throw new RangeError('too far');
    });
  } catch (e) {
    print('error from the thread:', e.name + ':', e.message);
  }
})();

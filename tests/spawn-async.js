// d8 --harmony-regions --verify-heap spawn-async.js
const log = [];
const note = (line) => { log.push(line); print(line); };

(async () => {
  // An async callback: the worker waits for the promise before replying.
  const page = spawn(async (id) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(20);
    const parts = [];
    for (let i = 0; i < 3; i++) {
      await null;
      parts.push(id + ':' + i);
    }
    return { id, parts };
  }, 'page-7').join();
  note(`async callback + join: ${page.id} ${page.parts.join(',')}`);

  // Awaiting the handle does not block the main thread.
  const work = (n) => {
    let total = 0;
    for (let i = 0; i < n; i++) total = (total + i * i) % 1000003;
    return total;
  };
  const start = performance.now();
  const pending = Promise.all([
    spawn((n) => { let t = 0; for (let i = 0; i < n; i++) t = (t + i * i) % 1000003; return { t }; }, 20_000_000),
    spawn(async (n) => { let t = 0; for (let i = 0; i < n; i++) t = (t + i * i) % 1000003; return { t }; }, 20_000_000),
  ]);
  note('main keeps running while tasks work');
  const [a, b] = await pending;
  note(`await Promise.all: ${a.t === work(20_000_000) && b.t === a.t} in ${(performance.now() - start).toFixed(0)} ms`);

  // Rejections keep their type for both await and join.
  try {
    await spawn(async () => { await null; throw new RangeError('async too far'); });
  } catch (e) {
    note(`await rejection: ${e.name}: ${e.message}`);
  }
  try {
    spawn(async () => { throw new SyntaxError('bad input'); }).join();
  } catch (e) {
    note(`join rejection: ${e.name}: ${e.message}`);
  }

  // A handle can be awaited and joined any number of times.
  const task = spawn(() => [1, 2, 3]);
  const first = await task;
  const second = await task;
  note(`await twice: same object ${first === second}, length ${first.length}`);
  note(`join after await: same object ${task.join() === first}`);

  // Results are owned by main again after the await.
  const owned = await spawn(() => ({ counter: 0 }));
  owned.counter += 5;
  note(`main owns the awaited result: counter = ${owned.counter}`);
})().catch((e) => print('UNEXPECTED', e));

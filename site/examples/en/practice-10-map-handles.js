// d8-flags: --module
// Practice 10. A map callback must return the task handle, not something else.
const heavy = (n) => {
  let t = 0;
  for (let i = 0; i < n; i++) t = (t + i * i) % 1000003;
  return t;
};
const parts = [0, 1, 2, 3];

// Bad: the callback starts a task but returns the part number.
let start = performance.now();
const bad = await Promise.all(parts.map((i) => {
  spawn(heavy, 20_000_000);
  return i;
}));
print(`bad:  Promise.all returned [${bad}] after ${(performance.now() - start).toFixed(1)} ms`);
await spawn.idle();
print(`      the tasks finished after ${(performance.now() - start).toFixed(0)} ms`);

// Good: the callback returns the handle, and Promise.all waits for the tasks themselves.
start = performance.now();
const good = await Promise.all(parts.map(() => spawn(heavy, 20_000_000)));
print(`good: Promise.all returned the results after ${(performance.now() - start).toFixed(0)} ms, ` +
  `all equal: ${good.every((v) => v === good[0])}`);

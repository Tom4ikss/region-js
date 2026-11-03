// Freezing: everyone can read, nobody can write. Broadcasting one object to three workers.
const region = new Region();
const config = region.run(() => ({ api: 'https://example.test', retries: 3, flags: ['a', 'b', 'c'] }));

region.freeze();
print('frozen:', region.frozen);

try {
  config.retries = 5;
} catch (e) {
  print('the owner writes:', String(e));
}

const workers = [0, 1, 2].map(
  (i) =>
    new Worker(
      `
      onmessage = ({ data: { config } }) => {
        let unborrowed;
        try { unborrowed = config.api; } catch (e) { unborrowed = String(e); }
        let reply;
        {
          // A frozen region can be read only under a borrow.
          using borrow = Region.of(config).borrow();
          let write;
          try { config.retries = 0; write = 'wrote'; } catch (e) { write = 'write denied'; }
          reply = 'worker ${i}: ' + config.api + ', flag ' + config.flags[${i}] + ', ' + write +
                  (${i} === 0 ? '\\n  without a borrow: ' + unborrowed : '');
        }
        // The borrow is already released: the main thread can call thaw().
        postMessage(reply);
      };
      `,
      { type: 'string' },
    ),
);

// No transfer list: a frozen region does not move, it becomes shared.
for (const w of workers) w.postMessage({ config });
for (const w of workers) print(w.getMessage());
print('the main thread reads too:', config.retries);

region.thaw();
config.retries = 5;
print('after thaw the owner writes:', config.retries);
for (const w of workers) w.terminate();

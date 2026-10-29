// Заморозка: читать могут все, писать никто. Рассылка одного объекта трём воркерам.
const region = new Region();
const config = region.run(() => ({ api: 'https://example.test', retries: 3, flags: ['a', 'b', 'c'] }));

region.freeze();
print('frozen:', region.frozen);

try {
  config.retries = 5;
} catch (e) {
  print('владелец пишет:', e.message);
}

const workers = [0, 1, 2].map(
  (i) =>
    new Worker(
      `
      onmessage = ({ data: { config } }) => {
        let write;
        try { config.retries = 0; write = 'записал'; } catch (e) { write = 'запись запрещена'; }
        postMessage('воркер ${i}: ' + config.api + ', флаг ' + config.flags[${i}] + ', ' + write);
      };
      `,
      { type: 'string' },
    ),
);

// Без transfer list: замороженный регион не переезжает, а становится общим.
for (const w of workers) w.postMessage({ config });
for (const w of workers) print(w.getMessage());
print('главный поток тоже читает:', config.retries);

region.thaw();
config.retries = 5;
print('после thaw владелец пишет:', config.retries);
for (const w of workers) w.terminate();

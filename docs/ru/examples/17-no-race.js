// Та же попытка с регионом: у обоих воркеров есть ссылка на счётчик, но писать может только владелец.
const region = new Region();
const counter = region.run(() => ({ value: 0 }));

const source = `
  onmessage = ({ data }) => {
    if (data.keep) { globalThis.counter = data.keep; postMessage('ok'); return; }
    let done = 0, denied = 0;
    for (let i = 0; i < 1_000_000; i++) {
      try { counter.value = counter.value + 1; done++; }
      catch (e) { denied++; }
    }
    if (data.owner) postMessage({ done, denied }, [Region.of(counter)]);
    else postMessage({ done, denied });
  };
`;
const a = new Worker(source, { type: 'string' });
const b = new Worker(source, { type: 'string' });

// Раздаём обоим ссылку на один и тот же объект (через заморозку, как рассылку).
region.freeze();
for (const w of [a, b]) w.postMessage({ keep: counter });
for (const w of [a, b]) w.getMessage();
region.thaw();

// Владельцем делаем только воркер A и запускаем обоих одновременно.
a.postMessage({ owner: true }, [region]);
b.postMessage({ owner: false });
const ra = a.getMessage();
const rb = b.getMessage();
print('воркер A (владелец): записей', ra.done, '| отказов', ra.denied);
print('воркер B (не владелец): записей', rb.done, '| отказов', rb.denied);
print('итог в главном потоке:', counter.value);
a.terminate();
b.terminate();

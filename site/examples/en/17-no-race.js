// The same attempt with a region: both workers have a reference to the counter, but only the owner can write.
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

// Give both a reference to the same object (through freezing, like a broadcast).
region.freeze();
for (const w of [a, b]) w.postMessage({ keep: counter });
for (const w of [a, b]) w.getMessage();
region.thaw();

// Make only worker A the owner and start both at the same time.
a.postMessage({ owner: true }, [region]);
b.postMessage({ owner: false });
const ra = a.getMessage();
const rb = b.getMessage();
print('worker A (owner): writes', ra.done, '| denied', ra.denied);
print('worker B (not owner): writes', rb.done, '| denied', rb.denied);
print('total in the main thread:', counter.value);
a.terminate();
b.terminate();

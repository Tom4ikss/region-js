// A data race on a SharedArrayBuffer: two workers increment one counter.
const counter = new Int32Array(new SharedArrayBuffer(4));
const source = `
  onmessage = ({ data: { buffer, atomic } }) => {
    const c = new Int32Array(buffer);
    for (let i = 0; i < 1_000_000; i++) {
      if (atomic) Atomics.add(c, 0, 1);
      else c[0] = c[0] + 1; // read, add, write: three steps, not one
    }
    postMessage('done');
  };
`;
for (const atomic of [false, true]) {
  counter[0] = 0;
  const workers = [new Worker(source, { type: 'string' }), new Worker(source, { type: 'string' })];
  for (const w of workers) w.postMessage({ buffer: counter.buffer, atomic });
  for (const w of workers) w.getMessage();
  print(atomic ? 'with Atomics.add:' : 'without Atomics: ', counter[0], 'of 2000000');
  for (const w of workers) w.terminate();
}

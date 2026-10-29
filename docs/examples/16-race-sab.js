// Гонка данных на SharedArrayBuffer: два воркера увеличивают один счётчик.
const counter = new Int32Array(new SharedArrayBuffer(4));
const source = `
  onmessage = ({ data: { buffer, atomic } }) => {
    const c = new Int32Array(buffer);
    for (let i = 0; i < 1_000_000; i++) {
      if (atomic) Atomics.add(c, 0, 1);
      else c[0] = c[0] + 1; // прочитать, прибавить, записать: три шага, а не один
    }
    postMessage('done');
  };
`;
for (const atomic of [false, true]) {
  counter[0] = 0;
  const workers = [new Worker(source, { type: 'string' }), new Worker(source, { type: 'string' })];
  for (const w of workers) w.postMessage({ buffer: counter.buffer, atomic });
  for (const w of workers) w.getMessage();
  print(atomic ? 'с Atomics.add:' : 'без Atomics:  ', counter[0], 'из 2000000');
  for (const w of workers) w.terminate();
}

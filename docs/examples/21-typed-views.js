// View отсоединяются, когда регион переезжает или замораживается.
const region = new Region();
const state = region.run(() => ({ samples: new Float64Array([1, 2, 3]) }));
const view = state.samples;

const worker = new Worker(
  `onmessage = ({ data: { state } }) => {
     state.samples[0] = 100; // у воркера свой view над той же памятью
     postMessage({ state }, [Region.of(state)]);
   };`,
  { type: 'string' },
);
worker.postMessage({ state }, [region]);
print('старый view, регион в воркере:', view.length, view[0]);
worker.getMessage();
print('старый view после возврата:', view.length);
print('поле прочитано заново:', state.samples[0], state.samples.length);
worker.terminate();

// Заморозка: view владельца отсоединяются, новые view только для чтения.
const before = state.samples;
region.freeze();
print('view до freeze:', before.length);
const frozen = state.samples;
frozen[1] = -1; // вне strict mode запись молча не проходит
print('запись в замороженный view:', frozen[1]);
try {
  frozen.fill(0);
} catch (e) {
  print('fill:', e.message);
}
region.thaw();
state.samples[1] = 20;
print('после thaw:', state.samples[1]);

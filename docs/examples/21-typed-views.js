// Views are detached when the region moves or is frozen.
const region = new Region();
const state = region.run(() => ({ samples: new Float64Array([1, 2, 3]) }));
const view = state.samples;

const worker = new Worker(
  `onmessage = ({ data: { state } }) => {
     state.samples[0] = 100; // the worker has its own view over the same memory
     postMessage({ state }, [Region.of(state)]);
   };`,
  { type: 'string' },
);
worker.postMessage({ state }, [region]);
print('old view, region in the worker:', view.length, view[0]);
worker.getMessage();
print('old view after the return:', view.length);
print('field read again:', state.samples[0], state.samples.length);
worker.terminate();

// Freezing: the owner's views are detached, new views are read-only.
const before = state.samples;
region.freeze();
print('view before freeze:', before.length);
const frozen = state.samples;
frozen[1] = -1; // outside strict mode the write silently fails
print('write to a frozen view:', frozen[1]);
try {
  frozen.fill(0);
} catch (e) {
  print('fill:', e.message);
}
region.thaw();
state.samples[1] = 20;
print('after thaw:', state.samples[1]);

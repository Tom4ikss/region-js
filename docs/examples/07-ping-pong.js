// Send an object there and back. Region.of(obj) finds the object's region.
const region = new Region();
const state = region.run(() => ({ turns: 0, last: '' }));

const worker = new Worker(
  `
  onmessage = ({ data: { state } }) => {
    state.turns += 1;
    state.last = 'worker';
    postMessage({ state }, [Region.of(state)]); // give ownership back
  };
  `,
  { type: 'string' },
);

let current = state;
const rounds = 1000;
const start = performance.now();
for (let i = 0; i < rounds; i++) {
  worker.postMessage({ state: current }, [Region.of(current)]);
  current = worker.getMessage().state;
  current.turns += 1; // we are the owner again
}
const us = ((performance.now() - start) / rounds) * 1000;

print('the very same object:', current === state);
print('turns:', state.turns, '| last writer:', state.last);
print(`one round trip: ${us.toFixed(1)} µs`);

try {
  Region.of({ plain: true });
} catch (e) {
  print('Region.of for a plain object:', e.message);
}
worker.terminate();

// d8 --harmony-regions --verify-heap ping-pong.js
const region = new Region();
const state = region.run(() => ({ turns: 0, log: ['start', '', '', '', ''] }));

const worker = new Worker(
  `
  onmessage = ({ data: { state } }) => {
    state.turns += 1;
    state.log[state.turns % 5] = 'worker ' + state.turns;
    postMessage({ state }, [Region.of(state)]);
  };
  `,
  { type: 'string' },
);

const rounds = 1000;
const start = performance.now();
let current = state;
for (let i = 0; i < rounds; i++) {
  worker.postMessage({ state: current }, [Region.of(current)]);
  current = worker.getMessage().state;
  current.turns += 1; // main owns it again
}
const elapsed = performance.now() - start;

print('same object came back:', current === state);
print('turns:', state.turns, 'last log:', state.log[(state.turns - 1) % 5]);
print(`round trip: ${((elapsed / rounds) * 1000).toFixed(1)} us`);

worker.postMessage({ state }, [Region.of(state)]);
try {
  state.turns;
} catch (e) {
  print('while worker owns it:', e.message);
}
worker.getMessage();
print('back in main:', state.turns);

try {
  Region.of({});
} catch (e) {
  print('Region.of on a plain object:', e.message);
}
worker.terminate();

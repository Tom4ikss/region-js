// Отправить объект туда и обратно. Region.of(obj) находит регион объекта.
const region = new Region();
const state = region.run(() => ({ turns: 0, last: '' }));

const worker = new Worker(
  `
  onmessage = ({ data: { state } }) => {
    state.turns += 1;
    state.last = 'воркер';
    postMessage({ state }, [Region.of(state)]); // вернуть владение
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
  current.turns += 1; // мы снова владельцы
}
const us = ((performance.now() - start) / rounds) * 1000;

print('тот же самый объект:', current === state);
print('ходов:', state.turns, '| последний писал:', state.last);
print(`один круг туда-обратно: ${us.toFixed(1)} µs`);

try {
  Region.of({ plain: true });
} catch (e) {
  print('Region.of для обычного объекта:', e.message);
}
worker.terminate();

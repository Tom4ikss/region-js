// d8 --harmony-regions --verify-heap freeze.js
const expectError = (name, fn) => {
  try {
    fn();
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}:`, e.message);
  }
};

const region = new Region();
const config = region.run(() => ({ name: 'prod', limits: [10, 20, 30], nested: { flag: true } }));

region.freeze();
print('frozen:', region.frozen, 'owner reads:', config.name);
expectError('owner writes while frozen', () => { config.name = 'dev'; });
expectError('run while frozen', () => region.run(() => ({})));

// Broadcast: the same objects go to every worker without a transfer list.
const workers = [0, 1, 2].map(
  (i) =>
    new Worker(
      `
      onmessage = ({ data }) => {
        if (data.cmd === 'read') {
          const borrow = Region.of(data.config).borrow();
          globalThis.borrow = borrow;
          postMessage('worker ${i}: ' + data.config.name + ' ' + data.config.limits[${i}] + ' ' + data.config.nested.flag);
        } else if (data.cmd === 'write') {
          try { data.config.name = 'hacked'; postMessage('worker ${i}: NO ERROR'); }
          catch (e) { postMessage('worker ${i} write: ' + e.message); }
        } else {
          globalThis.borrow.release();
          postMessage('released');
        }
      };
      `,
      { type: 'string' },
    ),
);
for (const w of workers) w.postMessage({ cmd: 'read', config });
for (const w of workers) print(w.getMessage());
print('readers:', region.readers);

workers[0].postMessage({ cmd: 'write', config });
print(workers[0].getMessage());

expectError('thaw while borrowed', () => region.thaw());
for (const w of workers) w.postMessage({ cmd: 'release' });
for (const w of workers) w.getMessage();
print('readers after release:', region.readers);

region.thaw();
config.name = 'dev';
print('after thaw owner writes:', config.name, 'frozen:', region.frozen);

workers[1].postMessage({ cmd: 'write', config });
print(workers[1].getMessage());

{
  region.freeze();
  using borrow = region.borrow();
  print('borrowed in scope, readers:', region.readers);
}
print('after scope, readers:', region.readers);
region.thaw();

const w = workers[2];
w.postMessage({ cmd: 'noop' }, [region]);
expectError('access while in transit', () => config.name);
for (const worker of workers) worker.terminate();

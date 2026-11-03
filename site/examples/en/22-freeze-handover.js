// Only the thread that froze a region can thaw it.
const region = new Region();
const config = region.run(() => ({ theme: 'dark' }));
region.freeze();
print('main thread: frozenHere =', region.frozenHere);

const worker = new Worker(
  `onmessage = ({ data: { config } }) => {
     const region = Region.of(config);
     const right = region.frozenHere;
     let thaw;
     try {
       region.thaw();
       config.theme = 'light';
       thaw = 'thawed, theme = ' + config.theme;
     } catch (e) {
       thaw = 'thaw: ' + String(e);
     }
     postMessage('frozenHere = ' + right + ', ' + thaw);
   };`,
  { type: 'string' },
);

// Without a transfer list the worker can read (under a borrow) but cannot thaw.
worker.postMessage({ config });
print('worker without the right:', worker.getMessage());

// A frozen region in the transfer list: the data stays shared,
// and the right to thaw passes to the worker.
worker.postMessage({ config }, [region]);
print('main thread: frozenHere =', region.frozenHere);
try {
  region.thaw();
} catch (e) {
  print('main thread, thaw:', String(e));
}
print('worker with the right:', worker.getMessage());
try {
  print(config.theme);
} catch (e) {
  print('main thread reads:', String(e));
}
worker.terminate();

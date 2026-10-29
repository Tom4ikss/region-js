// Разморозить регион может только тот поток, который его заморозил.
const region = new Region();
const config = region.run(() => ({ theme: 'dark' }));
region.freeze();
print('главный поток: frozenHere =', region.frozenHere);

const worker = new Worker(
  `onmessage = ({ data: { config } }) => {
     const region = Region.of(config);
     const right = region.frozenHere;
     let thaw;
     try {
       region.thaw();
       config.theme = 'light';
       thaw = 'разморозил, theme = ' + config.theme;
     } catch (e) {
       thaw = 'thaw: ' + e.message;
     }
     postMessage('frozenHere = ' + right + ', ' + thaw);
   };`,
  { type: 'string' },
);

// Без transfer list воркер может читать, но разморозить не может.
worker.postMessage({ config });
print('воркер без права:', worker.getMessage());

// Замороженный регион в transfer list: данные остаются общими,
// а воркеру переходит право разморозить.
worker.postMessage({ config }, [region]);
print('главный поток: frozenHere =', region.frozenHere);
try {
  region.thaw();
} catch (e) {
  print('главный поток, thaw:', e.message);
}
print('воркер с правом:', worker.getMessage());
try {
  print(config.theme);
} catch (e) {
  print('главный поток читает:', e.message);
}
worker.terminate();

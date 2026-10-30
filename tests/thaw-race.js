// d8 --harmony-regions --verify-heap thaw-race.js
// Readers of a frozen array without a borrow race with the owner, who thaws,
// grows the array (which replaces its storage) and freezes it again. A
// reader may see a stale value or an OwnershipError, never memory outside
// the array.
const region = new Region();
const data = region.run(() => ({ list: [0, 1, 2, 3] }));
region.freeze();

const READERS = 3;
const workers = Array.from({ length: READERS }, () => new Worker(`
  onmessage = ({ data: { data, ms } }) => {
    const deadline = performance.now() + ms;
    let reads = 0, bad = 0, denied = 0;
    while (performance.now() < deadline) {
      try {
        const list = data.list;
        // Indices past the end of the storage the reader may have loaded.
        for (let i = 0; i < 4096; i += 7) {
          const v = list[i];
          if (v !== undefined && v !== i) bad++;
          reads++;
        }
      } catch (e) {
        if (e.message.startsWith('OwnershipError')) denied++;
        else throw e;
      }
    }
    postMessage({ reads, bad, denied });
  };`, { type: 'string' }));

for (const w of workers) w.postMessage({ data, ms: 1500 });
const end = performance.now() + 1400;
let rounds = 0;
while (performance.now() < end) {
  region.thaw();
  const list = data.list;
  for (let i = list.length; i < 4096 && i < list.length + 257; i++) list.push(i);
  if (list.length >= 4096) list.length = 4;
  region.freeze();
  rounds++;
}
let bad = 0, reads = 0;
for (const w of workers) {
  const result = w.getMessage();
  bad += result.bad;
  reads += result.reads;
}
print('rounds:', rounds > 100, 'reads:', reads > 0, 'wrong values seen:', bad);
for (const w of workers) w.terminate();

// Three things that are easy to forget.
const tryIt = (label, fn) => {
  try {
    print(label + ':', fn());
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

// 1. Plain data (captured or passed as an argument) is copied. Changes in the thread do not come back.
let counter = 0;
const settings = { theme: 'dark' };
tryIt('in the thread', () => spawn((s) => { s.theme = 'light'; return ++counter; }, settings).join());
tryIt('in the main thread', () => counter + ', ' + settings.theme);

// 2. For changes to come back, the data must live in a region.
const region = new Region();
const state = region.run(() => ({ hits: 0 }));
spawn((s) => { s.hits += 1; }, state).join();
spawn(() => { state.hits += 1; }).join();
tryIt('region after two tasks', () => state.hits);

// 3. The result lives in a region: its shape is fixed.
const result = spawn(() => ({ total: 10, items: [1, 2] })).join();
result.total += 1;
tryIt('write to the result', () => result.total);
tryIt('new field', () => (result.extra = 1));
tryIt('plain copy', () => {
  const plain = { ...result, extra: 1 }; // shallow copy, items is still in the region
  return JSON.stringify(plain);
});

// d8 --harmony-regions --verify-heap spawn.js
const expectError = (name, fn) => {
  try {
    fn();
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};

// Result only.
const squares = spawn(() => {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(i * i);
  return { out, max: Math.max(...out) };
}).join();
print('squares:', squares.out.length, squares.out[4], 'max', squares.max);

// Arguments are moved in, the result is moved back.
const words = Array.from({ length: 50000 }, (_, i) => String.fromCharCode(97 + (i % 26)) + i);
const byLetter = spawn((list, letter) => {
  const hits = [];
  for (const word of list) if (word[0] === letter) hits.push(word);
  return { letter, count: hits.length, first: hits.slice(0, 2) };
}, words, 'c').join();
print('by letter:', byLetter.letter, byLetter.count, byLetter.first[0], byLetter.first[1]);

// Primitive result.
print('primitive:', spawn((a, b) => a * b, 6, 7).join());

// Captures are resolved from the closure.
const limit = 10;
function helper(x) { return x + 1; }
print('captured variable:', spawn(() => limit * 2).join());
print('captured function:', spawn((x) => helper(x), 1).join());
print('typeof capture:', spawn(() => typeof limit).join());
expectError('eval', () => spawn(() => eval('1')));
expectError('method shorthand', () => spawn({ m() { return 1; } }.m));
expectError('not a function', () => spawn(42));

// Errors thrown in the worker come back with their type.
expectError('worker throws', () => spawn(() => { throw new RangeError('too far'); }).join());
expectError('unmovable result', () => spawn(() => new Map()).join());
// A handle can be joined again and gives the same result.
{
  const task = spawn(() => ({ n: 1 }));
  print('double join, same result:', task.join() === task.join());
}

// Nested spawn: the worker has spawn too.
print('nested:', spawn((n) => spawn((m) => m + 1, n).join() * 10, 4).join());

// Several tasks run at the same time.
const work = (n) => {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + i * i) % 1000003;
  return total;
};
const N = 30_000_000;
let start = performance.now();
const sequential = [0, 1, 2, 3].map(() => spawn((n) => {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + i * i) % 1000003;
  return total;
}, N).join());
const sequentialMs = performance.now() - start;
start = performance.now();
const tasks = [0, 1, 2, 3].map(() => spawn((n) => {
  let total = 0;
  for (let i = 0; i < n; i++) total = (total + i * i) % 1000003;
  return total;
}, N));
const parallel = tasks.map((task) => task.join());
const parallelMs = performance.now() - start;
print('parallel results equal:', parallel.every((v) => v === work(N)) && sequential.every((v) => v === parallel[0]));
print(`4 tasks one by one: ${sequentialMs.toFixed(0)} ms, all at once: ${parallelMs.toFixed(0)} ms (x${(sequentialMs / parallelMs).toFixed(1)})`);

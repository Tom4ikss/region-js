// d8 --harmony-regions --verify-heap spawn-capture.js
const expectError = (name, fn) => {
  try {
    fn();
    print(`${name}: NO ERROR`);
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};

// Plain data and helpers are captured from the closure.
const words = Array.from({ length: 20000 }, (_, i) => String.fromCharCode(97 + (i % 26)) + i);
const limit = 6;
const weight = 3;
function score(word) { return word.length * weight; }
const top = spawn(() => {
  const scored = words.map((w) => ({ w, s: score(w) }));
  return scored.filter((x) => x.s > limit * 2).slice(0, 3).map((x) => x.w + '=' + x.s);
}).join();
print('captured data + helper:', top.join(' '));

// Captures from an enclosing function, recursion, a shadowed builtin.
function makeTask(base) {
  const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));
  const Map = { tag: 'not the builtin Map' };
  return () => ({ value: factorial(base), map: Map.tag });
}
const fromClosure = spawn(makeTask(10)).join();
print('closure capture:', fromClosure.value, fromClosure.map);

// A region object is moved: main loses access until the result comes back.
const region = new Region();
const state = region.run(() => ({ hits: 0 }));
const counted = spawn(() => {
  state.hits += 41;
  return state.hits + 1;
}).join();
print('moved region capture:', counted, '— and main has it back:', state.hits);

// A frozen region is shared: main can still read it while the worker does.
const configRegion = new Region();
const config = configRegion.run(() => ({ name: 'prod', retries: 3 }));
configRegion.freeze();
const seen = spawn(() => config.name + '/' + config.retries).join();
print('frozen region capture:', seen, '— main still reads', config.name);

// Things that cannot be sent.
const log = print;
let later;
expectError('native function', () => spawn(() => log('x')));
expectError('captured before init', () => {
  const task = () => spawn(() => notYet + 1);
  task();
  let notYet = 1;
});
const makeReader = (k) => () => k;
const readA = makeReader('a');
const readB = makeReader('b');
expectError('ambiguous name', () => spawn(() => readA() + readB()));
expectError('eval', () => spawn(() => eval('1')));
later = 1;

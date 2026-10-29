// d8 --harmony-regions --module spawn-handle.js
// A handle can be joined and awaited any number of times: every wait gets the
// same value or the same error.
const state = new Region().run(() => ({ n: 1 }));
const res = spawn(() => { state.n++; return state; });
const a = res.join();
const b = res.join();
const c = await res;
print('same:', a === b, b === c, 'n:', a.n, 'owner here:', Region.of(a).owner !== undefined);
a.n++;
print('writable:', c.n);

const failing = spawn(() => { throw new RangeError('boom'); });
try { failing.join(); } catch (e) { print('join 1:', e.name, e.message); }
try { failing.join(); } catch (e2) { print('join 2:', e2.name, e2.message); }
try { await failing; } catch (e) { print('await:', e.message); }

// await first, then join while still running.
const later = spawn(() => 42);
const p = later.then((v) => print('then:', v));
print('join after then:', later.join());
await p;
print('typed:', (() => { const t = spawn(() => new Int32Array([1, 2])); return t.join() === t.join(); })());

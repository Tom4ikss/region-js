// d8 --harmony-regions --verify-heap --expose-gc fuzz.js [-- rounds seed]
const [rounds = 300, seed = 1] = (globalThis.arguments ?? []).map(Number);
let state32 = seed >>> 0 || 1;
const random = (n) => {
  state32 ^= state32 << 13;
  state32 ^= state32 >>> 17;
  state32 ^= state32 << 5;
  return (state32 >>> 0) % n;
};

const WORKERS = 4;
const region = new Region();
const data = region.run(() => {
  const build = (depth) =>
    depth === 0 ? { value: 0, left: null, right: null } : { value: 0, left: build(depth - 1), right: build(depth - 1) };
  return { writes: 0, tree: build(10), list: [0, 0, 0, 0, 0, 0, 0, 0] };
});

const workerSource = `
  const touch = (node, write) => {
    let total = 0;
    for (let n = node; n; n = n.left) { if (write) n.value += 1; total += n.value; }
    return total;
  };
  onmessage = ({ data: message }) => {
    const { cmd, data, ms } = message;
    if (data) globalThis.data = data;
    const d = globalThis.data;
    const deadline = performance.now() + (ms || 0);
    let ok = 0, denied = 0, other = '';
    const attempt = (fn) => {
      try { fn(); ok++; }
      catch (e) { if (e.message.startsWith('OwnershipError')) denied++; else other = e.message; }
    };
    if (cmd === 'own') {
      // Owner: write for a while, then give the region back.
      while (performance.now() < deadline) {
        d.writes += 1;
        d.list[d.writes % 8] = d.writes;
        touch(d.tree, true);
      }
      if (Math.random() < 0.3) gc();
      postMessage({ ok: d.writes, data: d }, [Region.of(d)]);
      return;
    }
    if (cmd === 'poke') {
      // Not the owner: every access must be denied.
      while (performance.now() < deadline) {
        attempt(() => d.writes);
        attempt(() => { d.list[1] = 1; });
        attempt(() => touch(d.tree, false));
      }
    } else if (cmd === 'read') {
      // Frozen region: reads need a borrow and succeed, writes are denied.
      // The owner may thaw meanwhile; then borrowing fails and so do reads.
      while (performance.now() < deadline) {
        let borrow = null;
        try { borrow = Region.of(d).borrow(); } catch {}
        attempt(() => touch(d.tree, false) + d.list[3]);
        attempt(() => { d.writes = -1; });
        borrow?.release();
      }
    }
    postMessage({ ok, denied, other });
  };
`;
const workers = Array.from({ length: WORKERS }, () => new Worker(workerSource, { type: 'string' }));
const pokers = (except) => workers.filter((_, i) => i !== except);

// Every worker keeps references to the region objects from the start.
region.freeze();
for (const w of workers) w.postMessage({ cmd: 'read', data, ms: 0 });
for (const w of workers) w.getMessage();
region.thaw();

let current = data;
let expectedWrites = 0;
let illegalAccesses = 0;
let unexpected = [];

for (let round = 0; round < rounds; round++) {
  const action = random(3);
  if (action === 0) {
    // Move to a worker that writes while the others hammer the same objects.
    const owner = random(WORKERS);
    const others = pokers(owner);
    workers[owner].postMessage({ cmd: 'own', data: current, ms: 2 }, [Region.of(current)]);
    for (const w of others) w.postMessage({ cmd: 'poke', ms: 2 });
    try {
      current.writes;
      illegalAccesses++;
    } catch (e) {}
    for (const w of others) {
      const result = w.getMessage();
      illegalAccesses += result.ok;
      if (result.other) unexpected.push(result.other);
    }
    const back = workers[owner].getMessage();
    current = back.data;
    expectedWrites = back.ok;
  } else if (action === 1) {
    // Freeze, let everyone read, thaw while they are still reading.
    region.freeze();
    for (const w of workers) w.postMessage({ cmd: 'read', ms: 2 });
    const spin = performance.now() + 1;
    while (performance.now() < spin) {}
    // Readers hold borrows: thaw() waits until none is left.
    for (;;) {
      try {
        region.thaw();
        break;
      } catch (e) {
        if (!e.message.startsWith('Region is still borrowed')) throw e;
      }
    }
    current.writes += 0;
    for (const w of workers) {
      const result = w.getMessage();
      if (result.other) unexpected.push(result.other);
    }
  } else {
    current.writes += 1;
    expectedWrites += 1;
    if (random(4) === 0) gc();
  }
}

const writesConsistent = current.writes === expectedWrites;
const writes = current.writes;

// Free while every worker hammers the objects, then again after GCs have
// emptied them: no access may succeed, before or after.
let accessesAfterFree = 0;
for (const w of workers) w.postMessage({ cmd: 'poke', ms: 5 });
region.free();
for (const w of workers) {
  const result = w.getMessage();
  accessesAfterFree += result.ok;
  if (result.other) unexpected.push(result.other);
}
gc();
gc();
for (const w of workers) w.postMessage({ cmd: 'poke', ms: 2 });
for (const w of workers) {
  const result = w.getMessage();
  accessesAfterFree += result.ok;
  if (result.other) unexpected.push(result.other);
}
try {
  current.tree.left.value;
  accessesAfterFree++;
} catch (e) {}

print('rounds:', rounds, 'seed:', seed);
print('writes consistent:', writesConsistent, `(${writes})`);
print('illegal accesses that succeeded:', illegalAccesses);
print('accesses after free that succeeded:', accessesAfterFree);
print('unexpected errors:', unexpected.length ? [...new Set(unexpected)].join(' | ') : 'none');
for (const w of workers) w.terminate();

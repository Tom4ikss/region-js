// d8 --harmony-regions --module --expose-gc --verify-heap fuzz-holders.js [-- rounds seed]
// Random edits of a region array that holds values the engine materializes
// on every read: Region.fn functions, Region.localRef handles and typed
// arrays, mixed with numbers, strings and region objects. A plain array is
// the model; after every step both must agree, also inside a task, while
// frozen and after GC.
const [rounds = 400, seed = 1] = (globalThis.arguments ?? []).map(Number);
let state32 = seed >>> 0 || 1;
const random = (n) => {
  state32 ^= state32 << 13;
  state32 ^= state32 >>> 17;
  state32 ^= state32 << 5;
  return (state32 >>> 0) % n;
};

const fns = [
  Region.fn((x) => x + 1),
  Region.fn((x) => x * 10),
  Region.fn(function () { return this === undefined ? 'none' : typeof this; }),
];
const targets = [{ name: 'a' }, new Map([[1, 'b']]), [3, 'c']];
const refs = targets.map((t) => Region.localRef(t));

const region = new Region();
const list = region.run(() => []);
// Entries: { kind, k } for fn, ref and obj, { kind, bytes } for typed,
// { kind, value } for num and str.
const model = [];
let objects = 0;

const make = () => {
  switch (random(6)) {
    case 0: return { kind: 'num', value: random(2) ? random(1000) : random(1000) + 0.5 };
    case 1: return { kind: 'str', value: 'v' + random(50) };
    case 2: return { kind: 'fn', k: random(fns.length) };
    case 3: return { kind: 'ref', k: random(refs.length) };
    case 4: return { kind: 'typed', bytes: [random(256), random(256), random(256)] };
    default: return { kind: 'obj', k: objects++ };
  }
};
const valueOf = (entry) => {
  switch (entry.kind) {
    case 'fn': return fns[entry.k];
    case 'ref': return refs[entry.k];
    case 'typed': return new Uint8Array(entry.bytes);
    case 'obj': return region.run(() => ({ tag: entry.k }));
    default: return entry.value;
  }
};
const kindOf = (v) =>
  typeof v === 'function' ? 'fn'
  : v instanceof LocalRef ? 'ref'
  : ArrayBuffer.isView(v) ? 'typed'
  : typeof v === 'object' && v !== null ? 'obj'
  : typeof v === 'number' ? 'num' : 'str';

const fail = (step, what) => {
  print(`FAIL seed ${seed} step ${step}: ${what}`);
  quit(1);
};

const check = (step) => {
  if (list.length !== model.length) fail(step, `length ${list.length} != ${model.length}`);
  for (let i = 0; i < model.length; i++) {
    const v = list[i];
    const m = model[i];
    if (kindOf(v) !== m.kind) fail(step, `[${i}] is ${kindOf(v)}, expected ${m.kind}`);
    switch (m.kind) {
      case 'fn':
        if (v !== fns[m.k]) fail(step, `[${i}] another function`);
        if (m.k < 2 && v(2) !== (m.k === 0 ? 3 : 20)) fail(step, `[${i}] wrong result`);
        break;
      case 'ref':
        if (v !== refs[m.k] || v.deref() !== targets[m.k]) fail(step, `[${i}] another ref`);
        break;
      case 'typed':
        if (v.join() !== m.bytes.join()) fail(step, `[${i}] bytes ${v.join()} != ${m.bytes.join()}`);
        break;
      case 'obj':
        if (v.tag !== m.k) fail(step, `[${i}] tag ${v.tag} != ${m.k}`);
        break;
      default:
        if (v !== m.value) fail(step, `[${i}] ${v} != ${m.value}`);
    }
  }
};

const expectedKinds = () => model.map((m) => m.kind).join(',');

for (let step = 0; step < rounds; step++) {
  const op = random(12);
  if (op <= 2) {
    const entry = make();
    list.push(valueOf(entry));
    model.push(entry);
  } else if (op === 3 && model.length > 0) {
    const i = random(model.length);
    const entry = make();
    list[i] = valueOf(entry);
    model[i] = entry;
  } else if (op === 4 && model.length > 0) {
    list.pop();
    model.pop();
  } else if (op === 5 && model.length > 0) {
    const i = random(model.length);
    const n = 1 + random(2);
    list.splice(i, n);
    model.splice(i, n);
  } else if (op === 6) {
    // includes and indexOf of materialized values.
    const k = random(3);
    const fn = fns[k];
    const ref = refs[k];
    const fnAt = model.findIndex((m) => m.kind === 'fn' && m.k === k);
    const refAt = model.findIndex((m) => m.kind === 'ref' && m.k === k);
    if (list.indexOf(fn) !== fnAt || list.includes(fn) !== fnAt >= 0) fail(step, 'indexOf(fn)');
    if (list.indexOf(ref) !== refAt || list.includes(ref) !== refAt >= 0) fail(step, 'indexOf(ref)');
  } else if (op === 7) {
    // A task sees the same kinds; functions run there, refs do not deref.
    const seen = await spawn(() => {
      const kinds = list.map((v) =>
        typeof v === 'function' ? 'fn'
        : v instanceof LocalRef ? (v.local ? 'LOCAL' : 'ref')
        : ArrayBuffer.isView(v) ? 'typed'
        : typeof v === 'object' && v !== null ? 'obj'
        : typeof v === 'number' ? 'num' : 'str');
      const calls = list.filter((v) => typeof v === 'function').length;
      return kinds.join(',') + '|' + calls;
    });
    const calls = model.filter((m) => m.kind === 'fn').length;
    if (seen !== expectedKinds() + '|' + calls) fail(step, `task saw ${seen}`);
  } else if (op === 8) {
    region.freeze();
    check(step);
    if (list.map(kindOf).join(',') !== expectedKinds()) fail(step, 'map while frozen');
    region.thaw();
  } else if (op === 9) {
    gc();
  } else if (op === 10) {
    if (list.map(kindOf).join(',') !== expectedKinds()) fail(step, 'map');
    if ([...list].length !== model.length) fail(step, 'spread');
  }
  check(step);
}
print(`fuzz-holders: ${rounds} steps, ${model.length} values at the end, seed ${seed}`);

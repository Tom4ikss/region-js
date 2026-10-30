// d8 --harmony-regions --module --verify-heap array-methods.js
// Array methods, for...of, spread and Array.from on region arrays read the
// values straight from the array. Every result must match a plain array
// with the same values.
const show = (v) => JSON.stringify(v, (k, x) =>
  ArrayBuffer.isView(x) ? `view(${[...x]})` : Object.is(x, -0) ? '-0' : x);
const attempt = (fn) => { try { return fn(); } catch (e) { return `${e.name}: ${e.message}`; } };

const r = new Region();
const values = [3, 1.5, 'два', null, undefined, true, -0, NaN, 2 ** 40, 'three'];
const plain = values.slice();
const shared = r.run(() => values.slice());

const ops = {
  forOf: (a) => { const out = []; for (const v of a) out.push(v); return out; },
  entries: (a) => [...a.entries()],
  keys: (a) => [...a.keys()],
  spread: (a) => [...a],
  from: (a) => Array.from(a),
  fromMap: (a) => Array.from(a, (v) => typeof v),
  forEach: (a) => { const out = []; a.forEach((v, i) => out.push(i, v)); return out; },
  map: (a) => a.map((v) => typeof v),
  filter: (a) => a.filter((v) => typeof v === 'string'),
  reduce: (a) => a.reduce((s, v) => s + String(v), ''),
  some: (a) => a.some((v) => v === true),
  every: (a) => a.every((v) => v !== 0),
  find: (a) => a.find((v) => typeof v === 'string'),
  findLast: (a) => a.findLastIndex((v) => typeof v === 'number'),
  indexOf: (a) => [a.indexOf(1.5), a.indexOf('два'), a.indexOf(NaN), a.indexOf(0), a.indexOf(2 ** 40), a.indexOf(3, 1), a.indexOf(undefined)],
  includes: (a) => [a.includes(NaN), a.includes(0), a.includes(-0), a.includes('three'), a.includes(4), a.includes(3, 1)],
  lastIndexOf: (a) => a.lastIndexOf(3),
  join: (a) => a.join('|'),
  at: (a) => [a.at(0), a.at(-1), a.at(100)],
  slice: (a) => a.slice(2, 5),
  toSorted: (a) => a.slice(0, 2).concat(a.slice(8)).map(String).sort(),
};
let same = 0;
for (const [name, op] of Object.entries(ops)) {
  const p = show(op(plain)), s = show(op(shared));
  if (p === s) same++;
  else print(`MISMATCH ${name}: plain ${p} region ${s}`);
}
print('methods match:', same, 'of', Object.keys(ops).length);

// Typed arrays inside: read as fresh views by every path.
{
  const t = r.run(() => [new Uint8Array([1, 2]), 5]);
  print('typed arrays:', show([...t]), show(Array.from(t)), show(t.map((x) => x)),
        t.indexOf(t[0]), t.includes(5));
}

// for...of reads the length on every step; forEach keeps the initial one.
{
  const a = r.run(() => [1, 2, 3]);
  const seen = [];
  for (const v of a) { seen.push(v); if (a.length < 6) a.push(v * 10); }
  const visited = [];
  a.forEach((v) => { visited.push(v); if (a.length < 9) a.push(0); });
  print('growing:', show(seen), visited.length, a.length);
}

// A custom iterator is used when the protector is invalidated.
{
  const a = r.run(() => [1, 2, 3]);
  const original = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function* () { yield 'custom'; };
  print('custom iterator:', show([...a]), show(Array.from(a)));
  Array.prototype[Symbol.iterator] = original;
  print('restored:', show([...a]));
}

// Prototype elements beyond the length.
{
  const a = r.run(() => [1, 2]);
  Array.prototype[3] = 'proto';
  print('prototype element:', a.at(3), a.indexOf('proto'), a.includes('proto'));
  delete Array.prototype[3];
}

// Access rules hold: freed, moved, frozen without and with a borrow.
{
  const gone = new Region();
  const a = gone.run(() => [1, 2, 3]);
  gone.free();
  print('freed:', attempt(() => [...a]), '|', attempt(() => a.map((x) => x)), '|',
        attempt(() => a.indexOf(1)));
  const frozen = new Region();
  const b = frozen.run(() => [1, 2, 3]);
  frozen.freeze();
  const w = new Worker(`
    const attempt = (fn) => { try { return String(fn()); } catch (e) { return e.message; } };
    onmessage = ({ data }) => {
      const without = attempt(() => [...data].length);
      let withBorrow;
      { using _ = Region.of(data).borrow(); withBorrow = [[...data].length, data.indexOf(3), data.reduce((s, v) => s + v, 0)].join(','); }
      postMessage(without + ' | ' + withBorrow);
    };`, { type: 'string' });
  w.postMessage(b);
  print('frozen readers:', w.getMessage());
  w.terminate();
}

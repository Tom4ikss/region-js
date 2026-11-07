// d8 --harmony-regions --allow-natives-syntax region-string-keys.js
// Strings of a region as keys of Map and Set. Such a string is shared and
// cannot become a ThinString, so a lookup compares its contents with the keys
// of the table instead of internalizing it every time. A key that is added is
// still internalized, so a region string and an equal ordinary string are the
// same key whichever of them comes first.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};

const words = [];
for (let i = 0; i < 2000; i++) words.push('brand ' + i);
words.push('123', '4294967295', '-0', 'щука', 'a'.repeat(300), 'x');
const region = Region.share(words.map((s) => s));
const keys = words.map((_, i) => region[i]);
const plain = words.map((s) => s.split('').join(''));

// Strings that are already internalized, such as '-0' and 'x' here, stay as
// they are.
check('keys are shared strings',
    keys.filter((k) => %IsSharedString(k)).length === keys.length - 2);
check('keys equal the words', keys.every((k, i) => k === words[i]));

// Ordinary keys, looked up by region strings.
const byPlain = new Map(plain.map((s, i) => [s, i]));
check('Map.get', keys.every((k, i) => byPlain.get(k) === i));
check('Map.has', keys.every((k) => byPlain.has(k)));
check('Map.get of a missing key', byPlain.get(region[0] + '!') === undefined);

// Region keys, looked up by ordinary strings.
const byRegion = new Map();
for (let i = 0; i < keys.length; i++) byRegion.set(keys[i], i);
check('size', byRegion.size === keys.length);
check('get by ordinary strings', plain.every((s, i) => byRegion.get(s) === i));
check('get by region strings', keys.every((k, i) => byRegion.get(k) === i));
check('stored keys are internalized', [...byRegion.keys()].every(
    (k) => %IsInternalizedString(k)));

// The same key twice, from either side.
const both = new Map();
both.set(keys[5], 'region');
both.set(plain[5], 'plain');
both.set(keys[5], 'region again');
check('one entry for equal strings', both.size === 1 &&
    both.get(plain[5]) === 'region again');

// Mixed keys: the comparison must skip numbers, objects and other strings.
const mixed = new Map([[1, 'one'], [{}, 'object'], [123, 'number'],
                       [1.5, 'double'], [plain[2000], 'string 123']]);
check('string "123" is not the number 123',
    mixed.get(keys[2000]) === 'string 123' && mixed.get(123) === 'number');
mixed.set(keys[2001], 'big');
check('integer-index string', mixed.get('4294967295') === 'big');

// Set, and delete.
const set = new Set(plain);
check('Set.has', keys.every((k) => set.has(k)));
for (let i = 0; i < keys.length; i += 2) set.delete(keys[i]);
check('Set.delete', set.size === keys.length / 2 &&
    keys.every((k, i) => set.has(plain[i]) === (i % 2 === 1)));

// The same from optimized code.
function count(map, list) {
  let n = 0;
  for (const k of list) n += map.get(k) === undefined ? 0 : 1;
  return n;
}
%PrepareFunctionForOptimization(count);
count(byPlain, keys);
%OptimizeFunctionOnNextCall(count);
check('optimized Map.get', count(byPlain, keys) === keys.length &&
    count(new Map(), keys) === 0);

function has(set, list) {
  let n = 0;
  for (const k of list) if (set.has(k)) n++;
  return n;
}
%PrepareFunctionForOptimization(has);
has(set, keys);
%OptimizeFunctionOnNextCall(has);
check('optimized Set.has', has(set, keys) === keys.length / 2);

// Map.groupBy and getOrInsert go through the same lookup.
const groups = Map.groupBy(keys.slice(0, 20), (k) => keys[k.length % 2]);
check('Map.groupBy', groups.size === 2 && groups.get(plain[1]).length === 10 &&
    groups.get(plain[0]).length === 10);
const counts = new Map();
for (const k of [keys[0], plain[0], keys[0]]) {
  counts.set(k, counts.getOrInsert(k, 0) + 1);
}
check('getOrInsert', counts.size === 1 && counts.get(plain[0]) === 3);

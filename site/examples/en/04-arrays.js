// Arrays in a region: what works and what does not.
const tryIt = (label, fn) => {
  try {
    print(label + ':', fn());
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

const region = new Region();
const scores = region.run(() => [3, 1, 4, 1, 5]);

tryIt('for...of', () => {
  let sum = 0;
  for (const x of scores) sum += x;
  return sum;
});
tryIt('spread', () => Math.max(...scores));
tryIt('map/filter', () => scores.map((x) => x * 10).filter((x) => x > 10).join(','));
tryIt('slice', () => scores.slice(1, 3).join(','));
tryIt('includes', () => scores.includes(4));
tryIt('write by index', () => {
  scores[0] = 9;
  return scores[0];
});
tryIt('push', () => scores.push(2, 6));
tryIt('pop', () => scores.pop() + ', length ' + scores.length);
tryIt('splice', () => scores.splice(1, 2).join(',') + ' → ' + scores.join(','));
tryIt('length = 2', () => {
  scores.length = 2;
  return scores.join(',');
});
tryIt('new field on an object', () => {
  const user = region.run(() => ({ name: 'Ann' }));
  user.age = 30;
});

// Key enumeration and JSON work as with ordinary objects.
const point = region.run(() => ({ x: 1, y: 2 }));
tryIt('Array.isArray', () => Array.isArray(scores));
tryIt('Object.keys', () => JSON.stringify(Object.keys(point)));
tryIt('Object.entries', () => JSON.stringify(Object.entries(point)));
tryIt('for...in', () => {
  const keys = [];
  for (const key in point) keys.push(key);
  return keys.join(',');
});
tryIt('JSON.stringify', () => JSON.stringify({ point, scores }));
tryIt('flat', () => region.run(() => [[1, 2], [3]]).flat().join(','));
tryIt('object spread', () => {
  const copy = { ...point, z: 3 }; // a plain object, fields can be added to it
  return JSON.stringify(copy);
});
tryIt('destructuring', () => {
  const { x, y } = point;
  return x + y;
});

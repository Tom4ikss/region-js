// node --harmony-regions region-class.js
// Region.class() in Node.js: instances made in a region on the main thread
// go to spawn() tasks on workers, which compile the class for themselves, and
// instances tasks make in their regions come back as instances of the main
// thread's class.
'use strict';
const assert = require('node:assert');

const Point = Region.class(class Point {
  x = 0;
  y = 0;
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  get len() { return Math.hypot(this.x, this.y); }
  scaled(k) { return new Point(this.x * k, this.y * k); }
});

async function main() {
  const region = new Region();
  const points = region.run(() => [new Point(3, 4), new Point(6, 8)]);
  assert(Region.isRegionObject(points[0]) && points[0] instanceof Point);

  // The task reads the instances with its own class.
  const lens = await spawn((list) => list.map((p) => p.len).join(), points);
  assert.strictEqual(lens, '5,10');

  // An instance made in a task, in the region of its result.
  const made = await spawn((list) => {
    const proto = Object.getPrototypeOf(list[0]);
    return [list[0].scaled(2).len, Object.isFrozen(proto), proto.constructor.name];
  }, points);
  assert.deepStrictEqual([...made], [10, true, 'Point']);

  // Many tasks at once, each thread compiling the class once.
  const all = await Promise.all(Array.from({ length: 64 }, (_, i) => {
    const r = new Region();
    const p = r.run(() => new Point(i, 0));
    return spawn((q) => q.len + (Object.getPrototypeOf(q).constructor.name === 'Point' ? 0 : 1e6), p);
  }));
  assert.deepStrictEqual(all, Array.from({ length: 64 }, (_, i) => i));

  // Back on the main thread, the instances are of this thread's class.
  assert(Object.getPrototypeOf(points[1]) === Point.prototype);
  assert.strictEqual(points[1].len, 10);
  console.log('ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

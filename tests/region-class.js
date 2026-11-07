// d8 --harmony-regions --allow-natives-syntax --expose-gc --verify-heap region-class.js
// Region.class(C): classes whose instances can live in regions. In the
// current region `new` creates the instance there, with the fields the class
// declares and nothing else; elsewhere it creates a plain object. Every
// thread compiles the class for itself, frozen, so it may use only globals
// every thread has, primitives, other such classes and Region.fn functions.
const check = (name, ok) => {
  print(name + ':', ok);
  if (!ok) throw new Error('failed: ' + name);
};
const error = (fn) => {
  try {
    fn();
    return 'no error';
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};
const isRegion = (value) => Region.isRegionObject(value);

const Point = Region.class(class Point {
  x = 0;
  y = 0;
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  get len() { return Math.hypot(this.x, this.y); }
  add(other) { return new Point(this.x + other.x, this.y + other.y); }
  toString() { return `(${this.x}, ${this.y})`; }
  static origin() { return new Point(0, 0); }
  static dims = 2;
});

check('frozen class', Object.isFrozen(Point) && Object.isFrozen(Point.prototype));
check('statics', Point.dims === 2 && Point.name === 'Point');
check('same class again', Region.class(Point) === Point);

// Outside a region: a plain object.
const local = new Point(3, 4);
check('plain instance', !isRegion(local) && local instanceof Point && local.len === 5);
local.extra = 1;
check('plain instance is open', local.extra === 1);

// In a region.
const region = new Region();
const p = region.run(() => new Point(1, 2));
check('region instance', isRegion(p) && Region.of(p) === region);
check('instanceof', p instanceof Point && p instanceof Object);
check('prototype', Object.getPrototypeOf(p) === Point.prototype && p.constructor === Point);
check('fields', JSON.stringify(Object.keys(p)) === '["x","y"]' && p.x === 1 && p.y === 2);
check('getter and method', p.len === Math.hypot(1, 2) && String(p) === '(1, 2)');
const sum = region.run(() => p.add(p));
check('method creates in region', isRegion(sum) && sum.x === 2 && sum.y === 4);
check('method outside creates plain', !isRegion(p.add(p)) && p.add(p).y === 4);
check('static in region', isRegion(region.run(() => Point.origin())));
p.x = 10;
check('field write', p.x === 10 && p.len === Math.hypot(10, 2));
const undeclared = error(() => { p.z = 1; });
print(' ', undeclared);
check('undeclared field', undeclared.startsWith('TypeError') && undeclared.includes('declare'));
const inConstructor = Region.class(class Sloppy {
  a = 1;
  constructor() { this.b = 2; }
});
const sloppy = error(() => region.run(() => new inConstructor()));
print(' ', sloppy);
check('undeclared field in constructor', sloppy.startsWith('TypeError'));

// `this` in a closure of the constructor.
const Counter = Region.class(class Counter {
  n = 0;
  constructor(times) {
    const bump = () => { this.n++; };
    for (let i = 0; i < times; i++) bump();
  }
});
const counter = region.run(() => new Counter(3));
check('this in a closure', isRegion(counter) && counter.n === 3 && new Counter(2).n === 2);

// Field initializers create their objects in the region.
const Bag = Region.class(class Bag {
  items = [];
  meta = { count: 0 };
  add(item) { this.items.push(item); this.meta.count++; return this; }
});
const bag = region.run(() => new Bag().add('a').add('b'));
check('initializer literals', isRegion(bag.items) && isRegion(bag.meta) &&
      bag.items.join() === 'a,b' && bag.meta.count === 2);
const plainBag = new Bag().add('x');
check('initializer literals outside', !isRegion(plainBag.items) && plainBag.meta.count === 1);

// extends: the base must be such a class too; its fields come first.
const Point3 = Region.class(class Point3 extends Point {
  z = 0;
  constructor(x, y, z) {
    super(x, y);
    this.z = z;
  }
  get len() { return Math.hypot(super.len, this.z); }
});
const p3 = region.run(() => new Point3(2, 3, 6));
check('derived instance', isRegion(p3) && p3 instanceof Point3 && p3 instanceof Point);
check('derived fields', JSON.stringify(Object.keys(p3)) === '["x","y","z"]' && p3.len === 7);
check('derived plain', !isRegion(new Point3(1, 1, 1)));
const badBase = error(() => Region.class(class extends Array {}));
print(' ', badBase);
check('plain base', badBase.startsWith('TypeError'));

// What a class may use.
const SCALE = 3;
const Scaled = Region.class(class Scaled {
  v = SCALE;
  times(x) { return this.v * x; }
});
const scaled = region.run(() => new Scaled());
check('captured primitive', scaled.v === 3 && scaled.times(2) === 6);
const double = Region.fn((x) => x * 2);
const UsesFn = Region.class(class UsesFn {
  n = 21;
  get doubled() { return double(this.n); }
});
check('captured Region.fn', region.run(() => new UsesFn()).doubled === 42);
const UsesClass = Region.class(class UsesClass {
  at = null;
  constructor() { this.at = Point.origin(); }
});
const usesClass = region.run(() => new UsesClass());
check('captured class', isRegion(usesClass.at) && usesClass.at instanceof Point);

const config = { k: 1 };
const rejections = [
  ['captured object', () => Region.class(class { m() { return config.k; } })],
  ['private field', () => Region.class(class { #a = 1; })],
  ['private method', () => Region.class(class { #m() {} })],
  ['computed field', () => Region.class(class { ['a' + 'b'] = 1; })],
  ['numeric field', () => Region.class(class { 0 = 1; })],
  ['nested class', () => Region.class(class { m() { return class {}; } })],
  ['eval', () => Region.class(class { m() { return eval('1'); } })],
  ['not a class', () => Region.class(() => 1)],
  ['captured plain class', () => { class P {} return Region.class(class extends P {}); }],
];
for (const [name, fn] of rejections) {
  const message = error(fn);
  print(' ', name, '->', message);
  check(name, message.startsWith('TypeError'));
}
let sideEffects = 0;
const Static = Region.class(class Static {
  static ran = 0;
  static { sideEffects++; this.ran++; }
});
// Static members run for the class given, and again for this thread's class,
// which has its own copies of what it captures.
check('static block', sideEffects === 1 && Static.ran === 1 && Object.isFrozen(Static));

// 'use region' code: its classes are such classes.
function makeItem() {
  'use region';
  class Item {
    name = '';
    qty = 0;
    constructor(name, qty) {
      this.name = name;
      this.qty = qty;
    }
    total(price) { return this.qty * price; }
  }
  return Item;
}
const Item = makeItem();
check('use region class', Object.isFrozen(Item) && Region.class(Item) === Item);
const item = region.run(() => new Item('pen', 3));
check('use region instance', isRegion(item) && item instanceof Item && item.total(2) === 6);
check('use region class captures', error(() => {
  const outer = {};
  (function () { 'use region'; return class { m() { return outer; } }; })();
}).startsWith('TypeError'));

// A class in a function that runs again stays the same class while what it
// captures does.
function makeTwice() {
  'use region';
  return class Twice { v = 1; };
}
check('same class each call', makeTwice() === makeTwice());
const withValue = (n) => Region.class(class WithValue { v = n; });
check('same captures, same class', withValue(1) === withValue(1) && withValue(1) !== withValue(2));
check('new captures, new class', region.run(() => new (withValue(5))()).v === 5);

// ICs and optimized code.
function readLen(point) { return point.len + point.x; }
%PrepareFunctionForOptimization(readLen);
const pts = region.run(() => [new Point(3, 4), new Point(6, 8), new Point3(2, 3, 6)]);
for (let i = 0; i < 10; i++) readLen(pts[i % 3]);
%OptimizeFunctionOnNextCall(readLen);
check('optimized', readLen(pts[0]) === 8 && readLen(pts[1]) === 16 && readLen(pts[2]) === 9);
let acc = 0;
for (let i = 0; i < 20000; i++) acc += readLen(pts[i % 2]);
check('hot loop', acc === 10000 * 8 + 10000 * 16);

// Sealed regions keep the class.
const sealed = new Region();
const frozenPoint = sealed.run(() => new Point(5, 12));
sealed.seal();
check('sealed', frozenPoint.len === 13 && frozenPoint instanceof Point);

// Another thread compiles the class for itself.
const moved = new Region();
const shapes = moved.run(() => [new Point(3, 4), new Point3(1, 2, 2)]);
const inTask = spawn(() => [
  shapes[0].len,
  shapes[1].len,
  Object.isFrozen(Object.getPrototypeOf(shapes[0])),
  Object.getPrototypeOf(shapes[1]).constructor.name,
  Object.getPrototypeOf(Object.getPrototypeOf(shapes[1])) === Object.getPrototypeOf(shapes[0]),
  shapes[0].add(shapes[0]).x,
].join()).join();
print(' ', inTask);
check('in a task', inTask === '5,3,true,Point3,true,6');
check('back here', Object.getPrototypeOf(shapes[0]) === Point.prototype && shapes[1].len === 3);

gc();
gc();
check('after gc', p.len === Math.hypot(10, 2) && p3 instanceof Point3);

// d8 --harmony-regions --allow-natives-syntax --expose-gc --verify-heap region-prototypes.js
// Objects and arrays of regions have the prototypes of the thread that reads
// them: Object.prototype and Array.prototype. Their prototype cannot change.
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

const region = new Region();
const o = region.run(() => ({ a: 1, list: [1, 2, 3], nested: { b: 2 } }));

check('getPrototypeOf object', Object.getPrototypeOf(o) === Object.prototype);
check('getPrototypeOf array', Object.getPrototypeOf(o.list) === Array.prototype);
check('Reflect.getPrototypeOf', Reflect.getPrototypeOf(o.nested) === Object.prototype);
check('__proto__', o.__proto__ === Object.prototype && o.list.__proto__ === Array.prototype);
check('instanceof', o instanceof Object && o.list instanceof Array && o.list instanceof Object);
check('not instanceof Array', !(o instanceof Array));
check('isPrototypeOf', Object.prototype.isPrototypeOf(o) && Array.prototype.isPrototypeOf(o.list));
check('Array.isArray', Array.isArray(o.list) && !Array.isArray(o));
check('methods', o.hasOwnProperty('a') && o.list.includes(2) && String(o) === '[object Object]');
check('proxy', Object.getPrototypeOf(new Proxy(o, {})) === Object.prototype);

// The same prototype again is fine, as for any object.
check('setPrototypeOf same', Object.setPrototypeOf(o, Object.prototype) === o);
check('Reflect.setPrototypeOf same', Reflect.setPrototypeOf(o.list, Array.prototype) === true);
const other = error(() => Object.setPrototypeOf(o, null));
print(' ', other);
check('setPrototypeOf other throws', other.startsWith('TypeError'));
check('Reflect.setPrototypeOf other', Reflect.setPrototypeOf(o, {}) === false);
check('__proto__ set throws', error(() => { o.__proto__ = Array.prototype; }).startsWith('TypeError'));
check('still Object.prototype', Object.getPrototypeOf(o) === Object.prototype);

// Optimized code sees the same.
function protoOf(value) { return Object.getPrototypeOf(value); }
function isArray(value) { return value instanceof Array; }
%PrepareFunctionForOptimization(protoOf);
%PrepareFunctionForOptimization(isArray);
for (let i = 0; i < 3; i++) { protoOf(o); protoOf(o.list); isArray(o.list); isArray(o); }
%OptimizeFunctionOnNextCall(protoOf);
%OptimizeFunctionOnNextCall(isArray);
check('optimized', protoOf(o) === Object.prototype && protoOf(o.list) === Array.prototype &&
      isArray(o.list) && !isArray(o));

// Another thread sees its own prototypes.
const moved = new Region().run(() => ({ list: [1] }));
const inTask = spawn(() => Object.getPrototypeOf(moved) === Object.prototype &&
                           moved.list instanceof Array && moved instanceof Object).join();
check('in a task', inTask === true);

gc();
check('after gc', Object.getPrototypeOf(o.nested) === Object.prototype);

// What cannot go into a region.
const region = new Region();
const tryRun = (label, make) => {
  try {
    region.run(make);
    print(label + ': ok');
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

tryRun('function', () => ({ onClick() {} }));
tryRun('Map', () => ({ cache: new Map() }));
tryRun('Date', () => ({ when: new Date(0) }));
tryRun('BigInt', () => ({ big: 10n }));
tryRun('object from another region', () => ({ other: new Region().run(() => ({})) }));

// Typed arrays are allowed (guide.html#typed), but a bare ArrayBuffer, DataView
// and arrays over SharedArrayBuffer are not.
tryRun('Uint8Array', () => ({ bytes: new Uint8Array(4) }));
tryRun('ArrayBuffer', () => ({ buf: new ArrayBuffer(4) }));
tryRun('DataView', () => ({ dv: new DataView(new ArrayBuffer(4)) }));
tryRun('Int32Array over SharedArrayBuffer', () => ({ a: new Int32Array(new SharedArrayBuffer(8)) }));

// Only plain objects and arrays go into a region. A class instance and
// an Array subclass are an error too: without the class they would lose their methods.
class Point {
  constructor(x) { this.x = x; }
}
class List extends Array {}
tryRun('class instance', () => ({ p: new Point(7) }));
tryRun('Array subclass', () => List.from([1, 2]));
tryRun('object without a prototype', () => Object.assign(Object.create(null), { x: 1 }));

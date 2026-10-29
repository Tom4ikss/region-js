// Что нельзя положить в регион.
const region = new Region();
const tryRun = (label, make) => {
  try {
    region.run(make);
    print(label + ': ok');
  } catch (e) {
    print(label + ': ' + e.name + ': ' + e.message);
  }
};

tryRun('функция', () => ({ onClick() {} }));
tryRun('Map', () => ({ cache: new Map() }));
tryRun('Date', () => ({ when: new Date(0) }));
tryRun('BigInt', () => ({ big: 10n }));
tryRun('объект другого региона', () => ({ other: new Region().run(() => ({})) }));

// Типизированные массивы можно (раздел 9), а сам ArrayBuffer, DataView
// и массивы поверх SharedArrayBuffer нельзя.
tryRun('Uint8Array', () => ({ bytes: new Uint8Array(4) }));
tryRun('ArrayBuffer', () => ({ buf: new ArrayBuffer(4) }));
tryRun('DataView', () => ({ dv: new DataView(new ArrayBuffer(4)) }));
tryRun('Int32Array на SharedArrayBuffer', () => ({ a: new Int32Array(new SharedArrayBuffer(8)) }));

// В регион попадают только простые объекты и массивы. Экземпляр класса и
// наследник Array тоже ошибка: без класса они потеряли бы методы.
class Point {
  constructor(x) { this.x = x; }
}
class List extends Array {}
tryRun('экземпляр класса', () => ({ p: new Point(7) }));
tryRun('наследник Array', () => List.from([1, 2]));
tryRun('объект без прототипа', () => Object.assign(Object.create(null), { x: 1 }));

// d8-flags: --module
// Functions in a region: Region.fn.
const area = Region.fn(function () {
  return this.w * this.h;
});

const region = new Region();
const shapes = region.run(() => [
  { w: 2, h: 3, area },
  { w: 4, h: 5, area },
]);
print('areas:', shapes.map((s) => s.area()).join(', '));
print('same function:', shapes[0].area === area);

// The task gets the region together with its functions. The task's thread compiles
// the function from source text once and reuses it after that.
const total = await spawn(() => shapes.reduce((sum, s) => sum + s.area(), 0));
print('in a task:', total);

// The closure does not move with the function: it sees only its arguments,
// this, built-in globals and its own name.
const rate = 1.2;
try {
  Region.fn((x) => x * rate);
} catch (e) {
  print(e.name + ': ' + e.message);
}

// A region will not take an ordinary function.
try {
  region.run(() => ({ f: (x) => x * 2 }));
} catch (e) {
  print(e.name + ': ' + e.message);
}

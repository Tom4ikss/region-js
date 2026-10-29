// Every line below is a mistake the editor should underline.
// Type errors come from types/regions.d.ts, lint errors from rules/*.grit.

class Point {
  constructor(x) {
    this.x = x;
  }
}

const region = new Region();

// Type error: class instances and Map cannot go into a region.
region.run(() => new Point(1));
region.run(() => new Map());

// Type error: regions have no such method.
region.frezee();

// Type error: objects in a region have a fixed shape.
const state = region.run(() => ({ count: 0 }));
state.total = 1;

// Lint error: no classes inside spawn callbacks.
spawn(() => {
  class Local {}
  return new Local() ? 1 : 0;
});

// Lint error: no eval in spawn callbacks.
spawn(() => eval('1 + 1'));

// Lint error: a method cannot be sent to a worker.
spawn(Math.max, 1, 2);

// ESLint error: `counter` is in the worker until the task finishes.
const counter = new Region().run(() => ({ value: 0 }));
const counting = spawn(() => { counter.value++; });
print(counter.value);
await counting;

// Lint warning: nobody awaits this task, its result and errors are lost.
spawn(() => 1);

// Lint warning: join() blocks the thread; prefer await.
const value = spawn(() => 42).join();
print(value);

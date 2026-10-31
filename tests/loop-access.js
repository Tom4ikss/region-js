// d8 --harmony-regions --allow-natives-syntax --verify-heap loop-access.js
// Region access in loops. In a loop, Turbofan checks access to an object once
// instead of on every access, and leaves the loop through a deoptimization
// instead of calling the generic access. Only a call can take access away, so
// with a call in the loop the check stays in every iteration. Every result
// here must match the interpreter's (compare with --jitless).
const optimize = (fn, ...warmup) => {
  %PrepareFunctionForOptimization(fn);
  fn(...warmup);
  fn(...warmup);
  %OptimizeFunctionOnNextCall(fn);
  fn(...warmup);
  return fn;
};
const attempt = (fn) => {
  try {
    return fn();
  } catch (e) {
    return e.message;
  }
};
// 'optimized' unless Turbofan is on and the function is not optimized.
const tier = (fn) =>
  !%IsTurbofanEnabled() || %ActiveTierIsTurbofan(fn) ? 'optimized' : 'deoptimized';
const worker = () => new Worker('onmessage = () => {};', { type: 'string' });

// Loops without calls.
{
  const a = new Region().run(() => Array.from({ length: 100 }, (_, i) => i));
  const o = new Region().run(() => ({ x: 1, y: 2 }));
  const sum = optimize((a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s;
  }, a);
  const fill = optimize((a, v) => {
    for (let i = 0; i < a.length; i++) a[i] = v;
    return a[99];
  }, a, 1);
  const fields = optimize((o, n) => {
    for (let i = 0; i < n; i++) {
      o.x = o.x + o.y;
      o.y = i;
    }
    return o.x;
  }, o, 10);
  print('loops:', sum(a), fill(a, 2), sum(a), fields(o, 100), tier(sum), tier(fill),
        tier(fields));
}

// A call in the loop freezes the region: the writes after it fail.
{
  const r = new Region();
  const a = r.run(() => Array.from({ length: 10 }, () => 0));
  let freezeAt = -1;
  const maybeFreeze = (i) => {
    if (i === freezeAt) r.freeze();
  };
  const fill = optimize((a) => {
    for (let i = 0; i < a.length; i++) {
      maybeFreeze(i);
      a[i] = i;
    }
    return a[9];
  }, a);
  freezeAt = 5;
  print('freeze in loop:', attempt(() => fill(a)), JSON.stringify(a));
  r.thaw();
}

// A call in the loop moves the region to a worker: the reads after it fail.
{
  const w = worker();
  const a = new Region().run(() => [1, 2, 3, 4, 5, 6, 7, 8]);
  let moveAt = -1;
  const maybeMove = (i) => {
    if (i === moveAt) w.postMessage(a, [a]);
  };
  const sum = optimize((a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      maybeMove(i);
      s += a[i];
    }
    return s;
  }, a);
  moveAt = 3;
  print('move in loop:', attempt(() => sum(a)));
  w.terminate();
}

// A call in the loop gives up the borrow: the reads after it fail.
{
  const w = worker();
  const r = new Region();
  const a = r.run(() => [1, 2, 3, 4, 5, 6]);
  r.freeze();
  w.postMessage(a, [r]);  // the right to thaw goes to the worker
  let ticket = r.borrow();
  let releaseAt = -1;
  const maybeRelease = (i) => {
    if (i === releaseAt) ticket.release();
  };
  const sum = optimize((a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      maybeRelease(i);
      s += a[i];
    }
    return s;
  }, a);
  releaseAt = 2;
  print('release in loop:', attempt(() => sum(a)));
  w.terminate();
}

// Reading is allowed and writing is not: the write check is separate.
{
  const r = new Region();
  const a = r.run(() => [1, 2, 3]);
  const bump = optimize((a) => {
    for (let i = 0; i < a.length; i++) a[i] = a[i] + 1;
    return a[0];
  }, a);
  r.freeze();
  print('write to frozen:', attempt(() => bump(a)), JSON.stringify(a));
  r.thaw();
  print('after thaw:', bump(a));
}

// An outer loop with a call around an inner loop without one.
{
  const r = new Region();
  const rows = r.run(() => [[1, 2], [3, 4], [5, 6], [7, 8]]);
  let freezeAt = -1;
  const maybeFreeze = (i) => {
    if (i === freezeAt) r.freeze();
  };
  const bump = optimize((rows) => {
    for (let i = 0; i < rows.length; i++) {
      maybeFreeze(i);
      const row = rows[i];
      for (let j = 0; j < row.length; j++) row[j] = row[j] * 2;
    }
    return rows[3][1];
  }, rows);
  freezeAt = 2;
  print('nested loops:', attempt(() => bump(rows)), JSON.stringify(rows));
  r.thaw();
}

// One loop for plain arrays and region arrays.
{
  const r = new Region();
  const a = r.run(() => [1, 2, 3, 4, 5, 6]);
  const plain = [10, 20, 30, 40, 50, 60];
  let freezeAt = -1;
  const maybeFreeze = (i) => {
    if (i === freezeAt) r.freeze();
  };
  const bump = optimize((a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      maybeFreeze(i);
      a[i] = a[i] + 1;
      s += a[i];
    }
    return s;
  }, a);
  bump(plain);
  %PrepareFunctionForOptimization(bump);
  %OptimizeFunctionOnNextCall(bump);
  print('mixed loop:', bump(a), bump(plain), tier(bump));
  freezeAt = 3;
  const frozen = attempt(() => bump(a));
  freezeAt = -1;
  print('mixed loop, frozen:', frozen, bump(plain), JSON.stringify(a));
  r.thaw();
}

// A try block in the loop catches the error.
{
  const w = worker();
  const a = new Region().run(() => [1, 2, 3, 4]);
  let moveAt = -1;
  const caught = optimize((a) => {
    let s = 0;
    let errors = 0;
    for (let i = 0; i < 4; i++) {
      if (i === moveAt) w.postMessage(a, [a]);
      try {
        s += a[i];
      } catch (e) {
        errors++;
      }
    }
    return `${s} ${errors}`;
  }, a);
  moveAt = 2;
  print('try in loop:', caught(a));
  w.terminate();
}

// What the fast path can't do deoptimizes once: after that the loop calls
// the generic access, and the next optimized code stays.
{
  // Optimizes {fn} a few times: a deoptimization loop would end deoptimized.
  const settle = (fn, ...args) => {
    for (let i = 0; i < 3; i++) {
      %PrepareFunctionForOptimization(fn);
      fn(...args);
      %OptimizeFunctionOnNextCall(fn);
      fn(...args);
    }
    return `${fn(...args)} ${tier(fn)}`;
  };
  const a = new Region().run(() => [0, 0, 0, 0]);
  const fill = optimize((a, v) => {
    for (let i = 0; i < a.length; i++) a[i] = v;
    return a[3];
  }, a, 1);
  print('doubles:', fill(a, 0.5), settle(fill, a, 1.5));
  const local = optimize((a, v) => {
    for (let i = 0; i < a.length; i++) a[i] = v;
    return a[3];
  }, a, 'x');
  print('local strings:', local(a, 'local ' + a.length), settle(local, a, 'y' + a.length));

  const t = new Region().run(() => ({ bytes: new Uint8Array([1, 2, 3]) }));
  const typed = optimize((t) => {
    let s = 0;
    for (let i = 0; i < 3; i++) s += t.bytes[i];
    return s;
  }, t);
  print('typed array field:', typed(t), settle(typed, t));

  const numbers = new Region().run(() => [1, 2, 3, 4]);
  const past = optimize((a) => {
    let s = 0;
    for (let i = 0; i <= a.length; i++) s += a[i] === undefined ? 100 : a[i];
    return s;
  }, numbers);
  print('past the end:', past(numbers), settle(past, numbers));
}

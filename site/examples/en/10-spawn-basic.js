// spawn(callback, ...args): run a function on a separate thread and wait for the result.
const task = spawn((from, to) => {
  let primes = 0;
  for (let n = from; n < to; n++) {
    let isPrime = n > 1;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { isPrime = false; break; }
    if (isPrime) primes++;
  }
  return { from, to, primes };
}, 0, 200000);

print('the main thread does not wait while the task computes');
const result = task.join(); // join() blocks until the answer arrives
print('primes below', result.to + ':', result.primes);

// The result is owned by the main thread: it can be changed.
result.primes += 1;
print('after the write:', result.primes);

// A primitive result works too.
print('6 * 7 =', spawn((a, b) => a * b, 6, 7).join());

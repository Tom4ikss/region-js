// spawn(callback, ...args): запустить функцию в отдельном потоке и дождаться результата.
const task = spawn((from, to) => {
  let primes = 0;
  for (let n = from; n < to; n++) {
    let isPrime = n > 1;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { isPrime = false; break; }
    if (isPrime) primes++;
  }
  return { from, to, primes };
}, 0, 200000);

print('главный поток не ждёт, пока задача считается');
const result = task.join(); // join() блокирует, пока не придёт ответ
print('простых чисел до', result.to + ':', result.primes);

// Результат принадлежит главному потоку: его можно менять.
result.primes += 1;
print('после записи:', result.primes);

// Примитивный результат тоже можно.
print('6 * 7 =', spawn((a, b) => a * b, 6, 7).join());

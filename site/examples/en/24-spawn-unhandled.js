// d8-exit: 1
// Nobody waits for a task that failed. The error is not lost: d8 reports
// an unhandled promise rejection and exits with code 1.
spawn(() => {
  throw new RangeError('index out of range');
});
print('the main thread finished');

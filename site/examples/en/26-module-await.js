// d8-flags: --module
// With the --module flag, await works directly at the top level of the file.
const total = await spawn((n) => {
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += i;
  return sum;
}, 1000);
print('sum:', total);

// d8 also waits for a task without await, and only then exits.
spawn(() => {
  let x = 0;
  for (let i = 0; i < 30_000_000; i++) x += i;
  print('the task without await finished');
});
print('the file ran to the end');

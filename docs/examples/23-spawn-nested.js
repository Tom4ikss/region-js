// d8-flags: --module
// A task answers only after all the tasks it started itself.
const answer = await spawn(() => {
  spawn(() => {
    let x = 0;
    for (let i = 0; i < 30_000_000; i++) x += i; // a long nested task
    print('the nested task finished');
  }); // nobody waits for it
  print('the outer task returned a value');
  return 'done';
});
print('the main thread got:', answer);

// spawn.idle(): wait for all tasks this thread started.
spawn(() => print('a task without await'));
await spawn.idle();
print('spawn.idle() resolved');

// Each thread has its own pool.
spawn.poolSize = 6;
print('poolSize here:', spawn.poolSize, '| in a task:', await spawn(() => spawn.poolSize));

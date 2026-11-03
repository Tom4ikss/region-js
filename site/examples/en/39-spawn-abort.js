// d8-flags: --module
// Cancelling tasks: abort(), timeout(ms) and JoinSet.
const outcome = async (task) => {
  try {
    return 'result ' + (await task);
  } catch (e) {
    return e.name + ': ' + e.message;
  }
};

// The task waits on a channel nobody will write to.
const never = new Channel();
const stuck = spawn(async (never) => {
  await never.recv();
}, never);
stuck.abort();
print('abort:', await outcome(stuck));

// The same case with a timeout.
const slow = spawn((never) => never.recvSync(), never).timeout(50);
print('timeout:', await outcome(slow));

// A task that never waits checks the flag itself.
const loop = spawn(() => {
  let rounds = 0;
  while (!spawn.aborted()) rounds++;
  return rounds;
});
loop.timeout(20);
print('loop:', await outcome(loop));

// JoinSet: results in order of completion.
{
  using set = new JoinSet();
  for (const ms of [80, 10, 40]) {
    set.spawn((ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end);
      return ms;
    }, ms);
  }
  set.spawn(async (never) => {
    await never.recv();
  }, never);
  for (let i = 0; i < 3; i++) {
    const { value } = await set.next();
    print('done:', value, 'ms');
  }
  print('tasks left:', set.size);
}   // leaving the block cancels the remaining task

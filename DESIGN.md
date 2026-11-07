# Ownership regions in V8

**English** · [Русский](DESIGN.ru.md)

A research prototype: JS objects that live in a separate shared part of the heap, belong to
one thread and are passed between threads in O(1), like `move` in Rust.
The outcome: a working d8 with the prototype, benchmarks and conclusions. Possibly an engine fork.

The weekend MVP on `SharedArrayBuffer` is in `prototype/js-ownership/` and sets the
baseline for comparison.

## What is implemented and how it differs from the design

The implementation is `v8/regions.patch` on top of V8 from `v8/BASE`; the JS API is available in d8 with the
`--harmony-regions` flag. The sections after this one are the original design; where the implementation
diverged from it, this section says so.

- **Storage.** Objects live in the shared `SHARED_SPACE`, and the region number is a Smi in the object itself,
  not in the page header. Properties are in `keys` / `values` arrays, with one Map per object shape
  (the same keys in the same order), so the inline cache knows the field index from the
  “Map + name” pair.
- **Ownership check** on the IC fast path: a table of owner isolate addresses indexed by region
  number, and one comparison with the address of the current isolate. A write checks the value right there.
- **Prototypes.** There is no own prototype: the prototype is the `Array.prototype` /
  `Object.prototype` of the reading isolate, or the prototype of that isolate's class for an
  instance of a `Region.class` class. `Object.getPrototypeOf`, `instanceof`, `for...of`, spread
  and `map`/`filter` work; the prototype cannot be changed. `Object.keys`, `for...in`, `JSON.stringify` and `Array.isArray` work
  through enumeration of the region's keys.
- **A region can hold** plain objects (`Object.prototype` or `null`), arrays with
  `Array.prototype`, primitives, typed arrays, `Region.fn` functions,
  `Region.localRef` handles and instances of `Region.class` classes (below). Instances of other
  classes, `Map` and ordinary functions are an error.
- **`freeze` / `borrow`.** There is no borrow bitset: a region has a reader count, and who
  may read a frozen region is decided by the isolate's read table (“Mandatory borrow”
  below). `thaw` with readers is an exception; `thawWhenFree()` waits until the borrows are returned.
- **Returning and `Region.of(obj)`**: the handle of the object's region, so that it can be put into a transfer list.
- **Freeing.** A region number is reused when no objects of the region remain in the heap
  (checked at the end of a shared space collection, at a global safepoint) and there are no JS `Region` handles.
  A message in transit counts as a handle; the number's generation protects against stale messages.
- **`spawn(fn, ...args)`**: a worker pool, `join()` and `await`, capturing variables from the closure
  (data is copied, regions are moved and returned after the task, frozen ones are shared,
  functions travel as source), the lexical `this` and `arguments` of arrow functions. Classes, `eval`/`with`
  and native functions are an error at the call site.
- **Memory.** Unreachable objects of a live region are collected by the ordinary shared space GC: they are
  ordinary shared heap objects. A region number is released when the region has neither
  objects nor handles left. A region that has accumulated 64 KB (`--region-page-threshold`)
  gets its own shared space pages: they hold nothing but its objects and their value
  arrays, the region number is written in the page metadata, and the page is not evacuated and is
  released as a whole when it becomes empty. Literals are allocated on them in machine code through
  the region buffer in `Isolate`, and C++ allocates through `RegionAllocator`; on a region switch, the rest of the buffer
  goes to the next owner. This is step 1 of collecting a region without stopping the other threads
  (`research/region-gc.md`).
- **Who holds a region.** Each region has a 64-bit mask of the isolates that may hold
  pointers to its objects (`RegionRegistry::holders_`, step 2). A bit is set on creation,
  `Claim`, `SetReadable` and when an object is passed in a message, and only a
  full collection of the isolate itself clears it: before marking, it walks the roots, the young generation and
  `OLD_TO_SHARED` and clears the bit for regions to which it found no pointers, except its own region and
  the ones it froze. A move does not clear the bit: the old owner still has pointers.
- **Collection by the owner** (step 3). Below the threshold, a region allocates in chunks of common pages, from 1 to
  32 KB, and remembers them until the shared collection; its objects that the shared collection found alive on
  common pages it remembers as a list, so all of its objects can be found. If the set contains only
  the owner and the owner's report found no pointers to the region, the owner collects the region right away, during
  its own collection: the pages go to a pool for new regions, and the chunks and the objects from the list go to the common
  free list; large arrays are filled with `undefined`. If there are pointers, and
  since the last marking the region has allocated at least as much as was live then (and at least 1 MB),
  the owner marks it starting from those same pointers: a mark bitmap for the region's pages and
  a set for the rest. Dead memory on the pages becomes free memory of the
  region, and empty pages go to the pool. The report together with collection runs in full collections of clients and in the
  minor collection that an isolate requests after taking 64 pages of memory for regions
  (`--region-gc-pages`); marking runs only in the minor one. With `--verify-heap`, dead memory
  is filled with a pattern and is not reused until the shared collection, so that the verifier catches a
  remaining pointer.
- **Report requests** (step 4). If other isolates' bits prevent the owner from collecting or marking a region,
  and such regions have together allocated 1 MB or more, the owner asks those holders for two
  minor collections with a report. The request arrives as a task: the holder runs it in its message
  loop, between tasks. The holder that clears its bit last wakes the owner if the owner
  is waiting for the region. The isolate to ask is found by bit number in a table under the
  registry mutex. A blocking `getMessage` in d8 runs pending requests before and after
  waiting. There is no partial safepoint over the holders.
- **Region strings and numbers** (step 6). A string or `HeapNumber` that a region stores
  is put by the copy into that region's memory, and they die together with it; a string of another region
  is copied once more on write; shape keys are shared copies. `RegionOf` finds which region an object belongs to by the
  number on the page or by an index of chunk and object addresses on common pages (the page
  flag `REGION_MEMORY`). The shared collection clears the index before the traversal, because
  compaction moves objects on common pages: after it, strings in chunks become shared.
  When it releases a region number, it turns what is left of the region into shared memory.
  Flag `--no-region-strings`.
- **TypedArray** is the `JSRegionTypedArray` subclass: the region stores the `BackingStore` number, the type,
  the offset and the length, and reading the field gives a local view over the same memory. `run` copies the
  buffer; a buffer from the transfer list moves without a copy. On a move and on freezing, the owner's views
  are detached, and readers of a frozen region get an immutable view. Views
  of a frozen region are handed out only to the thread that froze it and to those holding a borrow
  (a `spawn` task gets a borrow at the moment `spawn()` is called); each thread detaches its own
  views itself when it returns its last borrow, thaws the region or gives away the right to thaw.
- **The right to thaw**: the thread that froze a region thaws it; a frozen region in a
  transfer list passes this right on. A `spawn` task finishes after its nested
  tasks, forgotten synchronous borrows are released at the end of the task, and `borrowWhile` holds the borrow
  until the promise settles. A task handle behaves like a promise: `join()` and `await` are repeatable.
- **Channels** (`src/regions/regions-channel.cc`): `new Channel(capacity)`, `send`/`recv`, `close`, `select`,
  async and blocking versions, `for await` and `for...of`. Primitives, strings, region objects
  and channels travel natively, as in the task port (see below); ordinary objects go through the `postMessage`
  serializer; the channel itself moves the regions that the value references directly.
  A blocking wait parks the thread for shared heap GC; `Worker.terminate()` removes
  the isolate's waits, and a value not yet read goes back to the channel.
- **Fast spawn** (≈6 µs per `spawn(...).join()`, was ≈40). Closure analysis is cached
  by the function's position in the script; `__prepareSpawn` returns a flat array
  `[code id, this, arguments, ...values]`, and the task code travels to the worker once per id.
  Messages are flat arrays, primitives travel without a region, and promises are created only for
  `await`. Before sleeping, threads spin for up to `--spin-wait-us` (50) in the platform task runner,
  `getMessage` and blocking channel operations: a wake-up through a condvar costs ≈5 µs.
- **Task port** (`src/regions/regions-port.cc`, ≈3.5 µs per `spawn(...).join()`). Tasks and replies go not through
  `postMessage` but through a native port: a message is an array of primitives, strings, region objects
  and channels, copied into a C++ buffer without ValueSerializer; region objects in transit
  are held by persistent handles of the shared space isolate (like SharedValueConveyor), and regions from the transfer
  list move with the message. A worker receives tasks with a drain task in its task runner,
  and a client picks up replies with a blocking `take()` (spin + park) or listens for them from the event loop.
  Channels use the same marshaling for such values; ordinary objects are still
  copied by the serializer.
- **Writing directly into a region.** `region.enter()` makes the region current (a stack per isolate; `run()`
  also pushes the region onto it) for `#{}` literals. Arrays have an `array_length` field,
  and `values()` keeps spare capacity (growth by 1.5 times), so `push` is linear; an indexed write
  (StoreRegionElement handler) and a single-element `push` (ArrayPrototypePush) write into
  the spare capacity without the runtime; prototype methods are cached as constants with the validity cell of the local
  `Array.prototype`/`Object.prototype` and a region access check in EmitAccessCheck. The IC
  reads the length and checks bounds against `array_length`. The evacuator copies fast-mode objects
  by map descriptors (a “map → region shape” cache) and dense arrays directly.
- **`#{}` / `#[]` literals** (`--harmony-region-literals`, turned on by
  `--harmony-regions`). The scanner produces `#{` and `#[` tokens, and the parser expands the literal into
  `%CreateRegionObjectLiteral(key, value, ...)` or `%CreateRegionArrayLiteral(...)`;
  the runtime creates the object directly in the current region (the stack of current regions is now in the engine core,
  and `enter()`/`run()` push onto it). Shapes are an isolate-wide cache “set of keys → keys +
  map”, which the evacuator also uses, so objects of one shape share a map, and ICs are monomorphic.
  Fast path: CallJSRuntime to the TFJ builtins `RegionObjectLiteral`/`RegionArrayLiteral` from the
  native context; the shape cache is in the native context (key hash → [map, keys, local keys]),
  the current region is in an isolate field, the object and its values are allocated as one chunk from the main thread's shared LAB
  (the LAB is moved out into `Isolate::shared_allocation_info()`, top/limit are external
  references), and a barrier is needed only during marking; the first literal of a shape and unusual cases go to the
  CPP builtins `Region*LiteralSlow`, and values that have to be copied go to
  `Runtime::kShareRegionLiteralValue`.
- **`spawn` pool:** one task port per pool, and all workers serve it
  (`PortState::servers`); `send` wakes a worker that is not currently draining the queue, and
  draining workers take tasks one at a time; the port remembers the task ids of each worker and, if the worker dies,
  replies for them with an error; task code is in the port (`port.code`), and `port.expect()` is for workers not yet
  started.
- **`DataOf()`** in ports and channels caches the isolate's entry in
  `thread_local`; `data_epoch` grows when an entry is deleted, so that a new isolate at the address of
  an old one does not get someone else's entry.
- **Channel queues:** receivers completed through another channel (`select`) or cancelled
  stay in the queue with `done` and are skipped; `ChannelState::stale` counts them, and the queue
  is cleaned when they make up half of it (amortized O(1) per delivery).
- **Deadlock detection** (`Deadlocks` in `src/regions/regions-channel.cc`): the embedder reports when an isolate's
  event loop goes to sleep and wakes up; d8 does it through libplatform (`DefaultForegroundTaskRunner::SleepObserver`);
  blocking channel waits and `port.take()` mark themselves. A thread is woken by whoever posts
  it a task or signals it, under their own mutex, so “everyone is asleep” is never falsely true even for an instant.
  When all isolates are asleep and there are no `timeout()` timers, the check waits 50 ms on a
  platform thread; if the epoch has not changed, channel and lock waits are cancelled with
  `DeadlockError`. Waiting for a delayed V8 task (memory reducer) counts as sleep.
  A wake-up of a loop caused only by its own tasks or by engine threads (garbage
  collection posts its next step as a task) does not change the epoch: libplatform asks the observer
  about every posted task (`PostedByOther`), and only tasks from other
  isolates count. Such a loop can wake another thread only with a channel, lock or
  task operation, or with a task posted to another loop, and those change the epoch themselves. Otherwise a GC that keeps
  posting tasks would hide a deadlock forever.
- **`RwLock`** (`src/regions/regions-channel.cc`): a `ChannelState` with `LockData`, so that a lock travels like a channel.
  The lock's region: `InTransit` while the lock is free; `Owned(writer)`; `Frozen(nobody, n)` for
  readers (`FreezeInTransit`/`ThawToTransit`). The grant is made under the channels mutex, and
  `Claim`/`Borrow` is done by the receiver's thread (`TakeGrant`); a grant that was not taken is returned
  (`ReturnUndeliveredLocked`). `RegionRegistry::locked_` forbids `Free`, `Freeze`, transfer
  and a `Borrow` by other threads; `OwnershipError` has separate texts for this.
- **`RwLock` poisoning:** `LockData::poisoned` is set by `ReleaseHeld` when a write guard
  is released by a cancelled task (`LockRelease`), when a task failed while leaving a guard held
  (`RwLock.__releaseTask` from `__endTask`; guards remember the task that took them), or
  when a thread goes away. `TakeGrant` refuses a poisoned lock with `PoisonError` and returns
  the grant.
- **Task cancellation:** the worker keeps the task id in continuation data (`Region.__task`), so
  channel and lock waits know their task even after `await`. `port.abort(id, name,
  message[, delay])`: a task from the inbox turns into a reply with its regions; for a running one,
  `PortState::aborted` replaces the result, and `Channels::AbortTask` cancels blocking
  waits right away and async ones with a task on the worker thread; new waits of a cancelled task
  fail until `TaskEnded`. A timeout is a delayed task on a platform thread.
- **Nested cancellation:** `spawn` on a pool worker remembers its children by the id of the current task
  (`Region.__task()`). `port.serve(onTask, onAbort)`: cancelling a running task posts an
  `AbortNoticeTask` to its worker, and `onAbort(id)` cancels the children with the same `port.abort`, and so on down the
  chain.
- **Cancellation at `await`:** while an isolate has a cancelled task
  (`Isolate::region_task_aborted_`, set by `Channels::AbortTask` from any thread), the four
  places where an `await` resumes (`PromiseReactionJob` with a generator instead of a handler,
  the closures `AsyncFunctionAwaitResumeClosure` and `AsyncGeneratorAwaitResume`,
  `AsyncResumeTask` in the microtask queue) ask `Runtime_RegionAwaitAbortError`. It
  checks the task by continuation data through a d8 hook (`RegionRegistry::SetTaskAbortHook`) and
  returns its error, and the generator resumes with a throw. Without cancellations this is one byte read per
  `await`. A wait on a promise that is not yet settled is woken by
  `RegionRegistry::InterruptTaskAwaits`: `onAbort` on the worker walks the heap, finds the `await` reactions of this task on
  pending promises (by the reaction's continuation data) and rejects
  each one separately (`JSPromise::TriggerPromiseReactions` for one reaction removed from the list).
  An `await` on the promise of an async function of the same task that is also waiting is skipped: the error
  will come from inside. An `await` chain is held only from the bottom: a promise holds reactions with
  generators, a generator holds its promise, and the bottom promise is held only by whoever will settle it.
  So `Await` (`builtins-async-gen.cc`), if the continuation data is a number (a task or a
  shield), puts the promise into an isolate list (`Isolate::region_task_awaits_`, a global handle
  to an `ArrayList`) directly in CSA while there is room below the threshold, and otherwise through
  `Runtime_RegionHoldTaskAwait` (`RegionRegistry::HoldTaskAwait`), which drops
  settled promises and doubles the threshold. About 5 ns per `await` on a pending promise. In
  `__endTask` the runner calls `Region.__forgetAwaits(id)` (`ForgetTaskAwaits`): promises
  that only this task and its shield are waiting for are released, and the functions it abandoned are
  collected. If no `await` of the task was found after all (the code waits for nothing), the runner replies for
  it itself (`__live`).
- **`spawn.shield(fn)`**: JS in the prelude: `fn` is called with continuation data `-(id + 1) -
  n·2³²`, with its own `n` for each shield. No task cancellation refers to it, so the task's
  waits (`CurrentTask` is not the task id), `await`s (the hook, the heap walk) and children (the parent is the
  shield id) do not see the cancellation; `RegionRegistry::ShieldedTask` recovers the task from the shield id.
  The heap walk counts such `await`s but does not touch them, and it skips an `await`
  on a shield's promise (the async wrapper `shielded`), like an `await` on a function of the task.
  The runner waits for the task's open shields (`spawn.__shielded(id)`) together with `spawn.idle()`;
  guards taken in a shield are released by `__releaseTask` together with the rest. Only a resumption with a value
  gets the cancellation error at an `await`: a promise rejection arrives as is. `{
  timeout }`: `port.deadline(id, name, message, ms)` posts a delayed task on a
  platform thread, and `port.ended(id)` from `close` removes it (`PortServer::deadlines` under the port
  mutex). A deadline that fires cancels the shield id as a task: `PortState::aborted`,
  `Channels::AbortTask` and `AbortNoticeTask`, so `onAbort` interrupts the shield's `await` and
  cancels its children. If there is nothing to interrupt after all, the runner closes the shield's accounting
  (`spawn.__shieldGone`). A lock held by a shield is released by `LockReleaseTask` via
  `ShieldedTask`.
- **`spawn.scope`**: JS in the d8 prelude (`SpawnScope`): a set of the block's handles, channels
  `s.channel()`, and the first error (`fail`) cancels the handles through `pool.abort` with `AbortError` and
  closes the channels; the block does not count the tasks' `AbortError` as a failure. The end of the block waits until
  the set of handles is empty, without `await`: in a cancelled task it would throw.
- **A `spawn` task's borrow of a frozen region:** `RegionRegistry::Reserve` in the calling
  thread increments `readers` without an isolate and holds the region number (`AddHandle`); the prelude
  keeps the token (`Region.__reserve`, `BorrowKind::kReservation`) in the task and returns it in
  `settle`, on any reply, including `#failAll`, or if `spawn()` threw. Region numbers
  travel in the message slot `reserved` as the string `,id,id,`; the worker takes the reservation for itself
  (`Region.__takeReserved`, `TakeReserved`/`DropReserved`: the read table and view accounting, without the
  counter), so the task is one reader both in the queue and while running. The worker returns its part
  in `__endTask` before the reply, and the caller returns the counter after the reply.
- **`region.thawWhenFree()`:** `Thaw`, and on `kBorrowed`, a `ChannelWaiter::Kind::kThaw` in
  `AsyncWaiters` (the deadlock detector and task cancellation see it) and in `ThawWaiters()` by
  region number. `Unborrow`/`Unreserve` that bring `readers` down to 0 call the d8 hook `ReadersFree`
  if there are waiters (`readers_waits_`, read without a mutex; otherwise they do not); under `channels_mutex` the hook wakes
  them with `WakeTask`, which tries `Thaw` again on the waiter's thread and, if there is a new reader,
  queues up again. The wake-up is not lost: the waiter increments `readers_waits_`,
  the returning side decrements `readers_`, both issue a seq_cst fence and only then read the other
  counter; the waiter rechecks `Readers` under the mutex after queuing. `Unborrow` is not called under
  `channels_mutex`.
- **Errors:** `OwnershipError`, `AbortError`, `TimeoutError`, `DeadlockError` and `PoisonError`
  are set up by `Genesis::InitializeGlobal_regions` (native context slots
  `REGION_*_ERROR_FUNCTION_INDEX`); `RegionRegistry::NewOwnershipError` and `NewTaskError`
  create them from the engine and from d8. A region's history is `RegionRegistry::Remember(region, Event,
  text)`: the last change of owner (a send or a thaw), the freeze, the free and the
  lock, by region number under a mutex, reset when the number is reused;
  the text is appended to an error with a matching `reason`. The location is taken by d8 (`ScriptLocations`):
  the first frame with a script name, excluding the prelude and the pool; the answer for a frame is cached by code and
  offset until the next collection, and `--no-region-history` turns recording off. The code of a `spawn` task
  is mapped by the factory to lines and columns of the source file (`Region.spawnCode().places`,
  indentation before each function, `//# sourceURL`), if all of it comes from one script and the functions
  are not nested in each other.
- **Launch site in a task's error stack:** `spawn()` calls `Region.__callerStack()`
  (`CallerStacks` in `src/regions/regions-runtime.cc`), which walks the JS frames and finds a text number by their code and offset (like
  `ScriptLocations`, cached until the next collection); the text “`at spawn()` and
  frames with a script file, up to 10” is built the first time a set of frames is seen and is kept by
  number while the isolate is alive. The number is stored in the task; on an error reply the prelude appends
  `Region.__callerStackText(id)` to the worker's stack. Nested tasks compose by themselves: the
  worker's stack already contains the launch site of the inner task. With `--no-spawn-stack`, d8 does not install
  `Region.__callerStack`, and the prelude sees `undefined` and writes `-1`.
- **Mandatory borrow.** A frozen region can be read only by the thread that
  froze it (or received the right to thaw it) and by those holding a borrow; `spawn` tasks take
  a borrow on what they capture by themselves. An isolate has a table “I can read frozen region N”
  (`Isolate::region_read_table_`, lazy, one byte per region), which the IC sees through an isolate-specific
  external reference; an entry is set on freeze/borrow/ClaimFreeze and cleared on thaw/last
  release/ReleaseFreeze/free, and in all tables when the region number is released.
- **Access in Maglev and Turbofan.** JSNativeContextSpecialization turns accesses to
  region objects into simplified-graph operators `LoadRegionField` / `StoreRegionField`
  (the position in `values()` comes from the IC handler `kRegionField`; a region Map is one set of keys,
  so the position is the same for all objects with that Map) and `LoadRegionElement` /
  `StoreRegionElement` (including appending at `index == length` into the spare capacity of `values()`).
  They are lowered in the turboshaft graph builder: the owner is checked against the owner table, and for
  reads of a frozen region against the isolate's read table; the index against `array_length` and the size of
  `values()`; the value on write (Smi, read-only, shared primitive, object of the same region).
  If the fast path does not apply, a load returns hole and a store returns false, and control goes
  to a clone of the original JS node, which keeps its feedback and is not specialized again (an ordinary
  IC call, without deoptimization; it throws the exceptions). Sites that see both region Maps and
  ordinary Maps are split by `CompareMaps`: ordinary ones go to the clone under `CheckMaps`, which is specialized
  as usual. In Maglev these are nodes with the same names, with code generation on arm64 and x64 (on other
  targets the IC call remains; Turbolev hands such functions to Turbofan). The
  `--no-inline-region-access` flag turns inlining off, and `tests/jit.js` compares the output with `--jitless`.
- **Owner check once per loop.** An isolate's access to a region is changed only by the
  isolate itself and only with a runtime call (a move, `freeze`, `thaw`, `free`, returning a borrow),
  so the check holds until the first node that can call something. Inside a loop,
  Turbofan (unless speculation is forbidden for the `JumpLoop`) places a
  `CheckRegionAccess` (deoptimization `kRegionAccess`) before the access, builds the access operators without their own
  owner check, and turns a fast-path failure into `CheckIf` instead of an IC call.
  `RedundancyElimination` removes repeated `CheckRegionAccess` of the same region (an object
  loaded from a region object lives in the same region; so does a loop phi of the form `n = n.next`),
  resets
  them at nodes that can call something, and does not carry them into a loop if its body contains such a
  node. The deoptimization carries the `JumpLoop` feedback and forbids speculation for it, and
  the next compilation of the loop calls the IC as before. Flag `--no-region-loop-speculation`,
  test `tests/loop-access.js`.
- **Array methods without a runtime call per element.** When an isolate can read a region (the owner,
  or a borrower of a frozen one), values are taken straight from `values()`: in the generic builtins
  `GetProperty` / `HasProperty`, through which `map`, `filter`, `forEach`, `reduce`, `some`,
  `every`, `find`, `at`, `slice` and others read elements (a region array has no holes, and every index
  below the length is present); in the array iterator (`for...of`, `entries`/`keys`/`values`); in the copy in
  `Array.from` and spread, while the array iterator protector is intact (one loop over `values()` into a new
  JSArray); in `includes` / `indexOf` (a loop over `values()` in the runtime, a separate one for Smi).
  A TypedArray element still takes the generic path (a new local view); an overridden
  `Array.prototype[Symbol.iterator]` is respected. On 100,000 numbers: `map` 21.5 → 1.46 ms,
  `for...of` 15.4 → 1.36, spread 17.0 → 0.28, `indexOf` 4.03 → 0.09. `tests/array-methods.js`
  compares each method with an ordinary array of the same values.
- **`Region.fn(f)`** instead of `Shared.fn`. d8 checks the function with the `spawn` analysis: it may capture
  only builtin globals, its own name and the global `this`; `eval`/`with`, classes and
  methods give `TypeError`. The engine (`JSRegionObject::NewFunction`) builds a descriptor
  `[id, source, script name, line, column]` with strings shared outside regions,
  compiles `"(" + source + ")"` with a line and column offset and tags the function with a private
  symbol of its isolate (not a root: this way the read-only heap does not change). A write to a region creates
  a `JSRegionFunction` (`JS_REGION_FUNCTION_TYPE`, a subclass of `JSRegionObject`): a copy of the
  descriptor in the region, one per function per `run`; the same function written over the same entry
  is not rewritten. A read is `ToJSValue`: a function from the isolate's cache (id → weak global
  handle) or a new compilation. Fast paths (IC, CSA, iterator, Maglev, Turboshaft) see the
  range `FIRST/LAST_JS_REGION_MATERIALIZED_TYPE` and go to the runtime, as with a typed array
  view. There is no deduplication between different writes: about 48 bytes per region.
- **`Region.class(C)`**, and every class declared in `'use region'` code. The same analysis as
  `Region.fn` finds what the class captures (primitives, `Region.fn` functions and other such
  classes); private members, computed field names, nested classes and `eval` give `TypeError`.
  The engine (`JSRegionObject::NewClass`) creates a sealed region with a holder
  (`JSRegionClass`): the source, its place, the declared instance fields (those of the base class
  first), the shared maps of instances, whose prototype is the holder, and the captures. Each
  isolate compiles the source once, as `'use region'` code, into a class of its own and freezes
  it with its prototype; `PrototypeOf` of an instance gives that prototype. The base
  constructor of such a class starts with `RegionClassThis`: in the current region it allocates
  the instance there with every field, and the constructor returns it; elsewhere `new` gives a
  plain object. Field initializers write into the record (`DefineOwnProperty` of a declared
  key is a write), and a key that is not declared gives `TypeError`. `tests/region-class.js`.
- **`Region.localRef(obj)`** instead of `Shared.localRef`. Returns a `LocalRef` wrapper
  (an ordinary isolate object with a prototype from d8 and a descriptor `[id, thread]` under a private
  symbol). The target lives in the creator isolate under a strong global handle. Writing the wrapper into a region
  creates a `JSRegionLocalRef` (`JS_REGION_LOCAL_REF_TYPE`, in the same range of
  materialized types as `JSRegionFunction`), and reading the holder gives this isolate's wrapper from
  a cache (id → weak handle with a callback). `deref()` in another isolate is `OwnershipError`
  `other-thread`. Lifetime: a global table id → {creator, target, number of live wrappers in
  all isolates, whether the last shared collection found a holder in an unfreed region, holder
  generation}. `ReleaseUnusedRegions` collects the ids of live holders; the creator, in the GC epilogue,
  releases the target if there are no wrappers, no holder was found, and no new holders have
  appeared since that collection. An accounting error gives `the object of this LocalRef was released` rather than a dangling
  pointer: everything goes through the table.
- **Not implemented:** region-local Maps with descriptors.
- **Runtime for embedders** (`src/regions/`, `include/v8-regions.h`). `Region`, channels, `RwLock`,
  the task port and `spawn` live in the engine, not in d8, so that d8 and Node.js run the same code. The
  embedder installs the globals (`Regions::InstallGlobals`) and `spawn` (`Regions::InstallSpawn`) and
  supplies three things: how to start a pool worker (`startWorker(source, port)`: d8 makes a `Worker`
  and posts the port, Node makes a `worker_threads` worker and hands the port over by number,
  `Region.__exportPort`/`__importPort`), the globals that every thread has (the probe context of the
  capture analysis), and an event loop that keeps running while the thread waits for a reply
  (`HasPendingWork`, `SetPendingWorkCallback`). The deadlock check needs the embedder to report when
  its loop sleeps; d8 does it through libplatform, Node does not yet. Per-isolate state hangs off
  `i::Isolate` and is released in `Isolate::Deinit` if the embedder did not do it. A `spawn` task's
  id shares the continuation data with the embedder's own (Node's `AsyncContextFrame`): while task
  code runs, the slot holds `[embedder data, task]`, and the API and the extras binding give the
  embedder only its part. In Node, regions in the transfer list of `postMessage` are handled in
  `node_messaging.cc` with `Regions::TransferredRegion`, `CheckTransfer`, `Release` and `Claim`.

## Decisions made

| Question | Decision |
|---|---|
| Engine and host | V8, `d8` and its `Worker` |
| Threads | An isolate per thread; regions are a separate shared part of the heap, modeled on shared space |
| What is stored | Objects and arrays without prototypes, numbers, strings, typed arrays, `Region.fn` functions, `Region.localRef` handles, instances of `Region.class` classes |
| Prototypes | No own prototype; the prototype is the `Array.prototype` / `Object.prototype` of the isolate that reads, or the prototype of its class |
| Functions | `Region.fn`: no closures, only builtin globals; each isolate compiles the source itself |
| Getting into a region | `#{}` / `#[]` literals and `'use region'` allocate directly in the region; `region.run(fn)` copies a ready graph |
| Object shape | One shared Map per set of keys in shared space, not a per-region one; the shape is fixed, there are no transitions |
| Access | One owner or many readers (shared borrow) |
| Ownership check | The region number in the object itself, an owner table by number, one comparison with the isolate address |
| Write with active readers | An exception, without waiting |
| Reference to a local object | Only through a `Region.localRef` handle; `deref()` only on the creator thread |
| Strings | Strings and numbers that a region stores are copied into its memory and die with it; shape keys are shared copies |
| GC | The owner itself collects an abandoned region and the garbage of a live one if other threads are not looking at it; otherwise, the shared heap collection; `free()` is immediate |
| Syntax | `#{}` / `#[]` literals and the `'use region'` directive; the rest is deferred |

## API

```js
const region = new Region();

const tree = region.run(() => build(20));     // everything created inside lives in the region
tree.left.value = 5;                          // the owner reads and writes

worker.postMessage({ tree }, [region]);       // region in the transfer list = move
tree.value;                                   // OwnershipError: the region belongs to another thread

// in the worker
onmessage = ({ data: { tree } }) => sum(tree);

// shared borrow
region.freeze();                              // writes are forbidden for everyone, including the owner
worker.postMessage({ tree, region });
using borrow = region.borrow();               // on any thread; release() on scope exit
region.thaw();                                // only the thread that froze it; if there are readers, an exception
await region.thawWhenFree();                  // or wait until the readers return their borrows

// functions without a closure
const sum = Region.fn(function sum(node) {
    return node.value + (node.left ? sum(node.left) : 0) + (node.right ? sum(node.right) : 0);
});
region.run(() => ({ reducer: sum }));         // stored in the region, each isolate compiles it itself

// a handle to an object of your own thread
const ref = region.run(() => ({ ui: Region.localRef(domLikeObject) }));
ref.ui.deref();                               // returns the object on the creator thread, throws on another
```

In the design these were `Shared.fn` and `Shared.localRef`. `Region.fn` rejects a function if it
has captured variables, or globals other than builtins; the analysis is the same as for `spawn`.
`Region.localRef` is an analog of `SendWrapper` from Rust: it holds a global handle in the creator isolate,
and the region stores only the handle number and the thread number, so GC does not trace references from the region
to the outside.

## Internals

The original plan. It was done differently: objects live in `SHARED_SPACE`, large regions on their own
pages of it, the region number is in the object, Maps are shared per shape, and there is no borrow bitset
(see “What is implemented”).

**A region** is a set of pages in a separate heap space, next to `SHARED_SPACE`
(`--shared-heap`). The pointer to the region descriptor is stored in `BasePage`, not in
`MemoryChunk`: `MemoryChunk` flags are considered untrusted in sandbox builds.
The descriptor has an atomic state word:

```
state: Owned(isolate_id) | Frozen(owner_id, readers) | Sealed
```

- `move` is `compareExchange(Owned(me), Owned(target))`.
- `freeze` is `Owned(me) → Frozen(me, 0)`; `borrow` is `readers + 1`; `thaw` only when `readers == 0`.
- `seal` is `Owned(me) | Frozen(me, n) → Sealed`, like `Arc<T>`. In the prototype this is `Frozen` with `frozen_by_ == kSealedBy`: it cannot be thawed or freed, and the right cannot be handed over. The bit in the read table is set on the slow path at the first read and is not cleared until the collector releases the number (`ReleaseUnusedRegions` clears all tables), so the fast path in IC, Maglev and Turbofan did not change. Typed array views are not tracked and are not detached.
- Each isolate has a bitset of the regions it currently borrows.

**Access check**: `page(obj) → region → state`. Allowed if `Owned(me)`, or
`Frozen` and the region is in the current isolate's bitset. Writing is allowed only with `Owned(me)`.

**Hidden classes** are allocated in the region. Only the owner makes transitions, and readers
see a frozen tree, so no locks are needed.

**Bypassing fast paths.** Hundreds of builtins read objects directly, bypassing inline
caches. Region objects get their own instance type `JS_REGION_OBJECT_TYPE` in the
special receivers range: then inline caches and generic builtins go to the runtime by themselves. The
`is_access_check_needed` bit does not fit: it is allowed only on a special receiver and leads into
the embedder's access checks. `LookupIterator` gets its own state `REGION_OBJECT`,
modeled on `WASM_OBJECT` for Wasm GC objects (they are also special receivers, also live in shared
space and are also passed by reference; this is the main precedent). Separately check the builtins
that bypass `LookupIterator`: key enumeration, `ElementsAccessor`, `CloneObject`.
In v2 inline caches get an inline ownership check, and the hot path does not go to the runtime.

**References to the outside.** The write barrier records nothing for a host in shared space, so
a reference from a region to a local object would break GC. Every write to a region object goes through
a barrier in the spirit of `SharedValueBarrier` for shared structs: a value from the region or a primitive
is written; a local object is an exception (outside `run`) or an evacuation (inside `run`).

**Allocation in `region.run`.** The JIT allocates literals inline in the young generation and removes the
write barrier for fresh objects, assuming they are young. Redirecting this allocation into a region
is not possible without rewriting Turboshaft and Maglev, and `--no-inline-new` does not cancel this
assumption. So in v1 `fn` runs as usual, and the graph reachable from the result
is evacuated into the region on exit from `run`: once, O(n) at creation. `move` still
stays O(1). The cost: objects that local references inside `fn` still point to are
different objects, not the ones that live in the region. A real allocation scope is stage 6.

**Passing through `postMessage`.** Region objects are serialized by reference along the same path
as shared structs and shared Wasm objects: `ValueSerializer::WriteSharedObject` and
`SharedValueConveyor`, and the receiver sees the same pointer. A region in the d8 transfer list
means `move`.

## Stages

0. Build `d8`, try out `--shared-heap` and `--experimental-wasm-shared`. Shared structs
   are dead in current V8: `--harmony-struct` and `--shared-string-table` are fixed to `false`,
   and `SharedStructType` is not installed. The live precedent is shared Wasm GC objects.
1. The region space, `new Region()`, `region.run(fn)` with evacuation of the result:
   objects and arrays without prototypes.
2. Ownership checks: `JS_REGION_OBJECT_TYPE`, the `REGION_OBJECT` state in `LookupIterator`,
   `OwnershipError`; a write barrier for references to the outside.
3. `postMessage(msg, [region])`. A benchmark against structured clone and the SAB MVP.
4. `freeze` / `borrow` / `thaw`, the borrow bitset.
5. Strings through `Object::Share` into shared space, `Shared.fn`, `Shared.localRef`.
6. Performance: an inline check in inline caches, allocation without the runtime, inlining
   access in Maglev and Turbofan, an owner check once per loop in Turbofan.
7. Freeing regions and GC inside a region.

All stages are done; what went into each release is in `CHANGELOG.md`.

## Deferred

- **`region.alloc(type, ...values)`.** A vague idea: one function that allocates in a region
  an object of any builtin type (`Map`, `Set`, `Date`, ...). For each type one would have to
  decide separately where its internal state lives, how other isolates read it and what
  to do with prototype methods. There is no scheme yet.
- **Owner check once per loop in Maglev.** Done in Turbofan: in a loop, a region access
  deoptimizes instead of making the fallback IC call, a separate
  `CheckRegionAccess` check stays valid until the first call, and `RedundancyElimination` removes
  repeated ones. The deoptimization marks the `JumpLoop` hints so as not to loop.

## Criteria

Success if at least half of these hold:

- `move` in O(1): the time does not depend on the graph size;
- field access in optimized code at most 1.5 times slower than with an ordinary object
  (6.4 times in the SAB MVP);
- near-linear scaling of parallel reads;
- ordinary JS does not slow down, and races in fuzzing give exceptions, not a process crash.

Result: `move` in O(1): yes; a field read at ×1.2 of an ordinary object: yes, but writes at ×1.7 and
indexed access at ×2.3; reading on 8 threads is 5.9 times faster than on one. Ownership races
are exercised by `tests/fuzz.js`, and the values the engine materializes on read by
`tests/fuzz-holders.js`. The numbers are on the site's “Numbers” page (`site/src/content/docs/numbers.mdx`).

## Risks and open questions

- **A missed fast path = a security hole.** Any builtin that
  reads a region object bypassing the check gives a data race on the heap. Fuzzing is needed.
- **Stale pointers and freeing.** After a `move`, the sender keeps raw
  pointers to region objects. While they exist, the pages cannot be reused:
  otherwise the ownership check would read someone else's descriptor. A region can be freed only
  when no isolate references it, and this requires coordination between isolates
  (epochs, or each GC reporting which regions it references). What was done: a number
  is reused only when the shared collection found none of its objects in the heap, the number's generation
  cuts off stale messages, and the holder mask and isolate reports (“Who holds a region”)
  let the owner collect a region without a shared collection.
- **GC inside a region.** Compaction or sweep requires knowing all incoming references from all
  isolates, including their stacks. This comes down to a global safepoint: the same stop-the-world
  that was meant to be avoided. That is how it was done: region objects are collected by the shared heap collection at a
  global safepoint. Collecting one region without stopping the other threads is an open question;
  the analysis, the literature and the plan are in `research/region-gc.md`.
- **Feedback vectors.** Inline caches of other isolates hold weak references to region Maps.
  When a region dies, they have to be cleared in all isolates. Not needed: Maps are shared per
  shape, not per region, and do not die with the region.

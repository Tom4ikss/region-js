// Types for the ownership-regions prototype (d8 --harmony-regions).

/** Typed arrays that can live in a region. SharedArrayBuffer-backed and
 * resizable ones are rejected at run time. */
type RegionTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float16Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/** Data that can be copied into a region: primitives, typed arrays, plain
 * arrays and plain objects. Functions, class instances, Map, Set, Date and
 * symbols are not allowed. */
type RegionData =
  | null
  | undefined
  | boolean
  | number
  | string
  | RegionTypedArray
  | RegionData[]
  | { readonly [key: string]: RegionData };

/** Thrown when a thread touches a region it does not own, writes into a frozen
 * region or links a region object to an object outside the region. In this
 * prototype it is a TypeError whose message starts with "OwnershipError:". */
type OwnershipError = TypeError;

/**
 * A set of objects in shared memory owned by one thread at a time.
 *
 * - `run` copies data into the region; objects in it have a fixed shape.
 * - `worker.postMessage(message, [region])` moves the region without copying:
 *   the sender loses access, the receiver becomes the owner.
 * - `freeze` lets every thread read the region and nobody write it.
 */
declare class Region implements Disposable {
  constructor();

  /** Number of the region in the process-wide table. */
  readonly id: number;
  /** Id of the owning isolate (thread); -1 while the region is in transit. */
  readonly owner: number;
  readonly frozen: boolean;
  /** Whether this thread froze the region, or was handed the right to thaw
   * it; only that thread may call thaw(). */
  readonly frozenHere: boolean;
  /** Number of active borrows of a frozen region. */
  readonly readers: number;

  /**
   * Runs `fn` and copies the value it returns into the region. Cycles and
   * shared sub-objects are preserved. Typed arrays are copied unless their
   * buffer is in `transfer`: those move without copying and are detached.
   */
  run<T extends RegionData>(fn: () => T, transfer?: ArrayBuffer[]): T;

  /** Makes the region current until the scope is disposed:
   * `using _ = region.enter()`. Region.object() and Region.array() then
   * create objects in it. run() makes the region current too. */
  enter(): RegionScope;
  /** A plain object copied into this region. Its shape is fixed. */
  object<T extends { readonly [key: string]: RegionData }>(value: T): T;
  /** An array of `items` in this region. Region arrays grow and shrink:
   * push, pop, splice and length work. */
  array<T extends RegionData>(...items: T[]): T[];
  /** The same in the current region (see enter()). */
  static object<T extends { readonly [key: string]: RegionData }>(value: T): T;
  static array<T extends RegionData>(...items: T[]): T[];

  /** Everyone may read, nobody may write. Detaches the owner's typed array
   * views; readers get immutable views. */
  freeze(): void;
  /** Gives write access back to the owner. Throws while the region is borrowed. */
  thaw(): void;
  /** Keeps a frozen region from being thawed until the borrow is released.
   * A frozen region can only be read under a borrow (or by the thread that
   * froze it): plain fields and typed arrays alike. A borrow also keeps the
   * region from being thawed, so a reader never sees a thaw mid-read.
   * Typed array views are detached when the borrow ends.
   * A spawn() task borrows the frozen regions it gets by itself, and a borrow
   * taken in a task ends with the task at the latest. */
  borrow(): RegionBorrow;
  /** Keeps a frozen region borrowed while `fn` runs, or until the promise it
   * returns settles. Use it for async work inside a task. */
  borrowWhile<T>(fn: () => T): T extends PromiseLike<infer R> ? Promise<R> : T;

  /** Frees the region: every later access throws OwnershipError, typed
   * array memory is released at once and the objects are emptied at the
   * next shared GC, even if something still refers to them. Only the owner
   * may free it (or, while frozen, the thread that froze it, with no borrows
   * left). `using region = new Region()` frees it at the end of the block,
   * unless it has moved away by then. */
  free(): void;
  [Symbol.dispose](): void;
  readonly freed: boolean;
  /** Bytes copied into the region, roughly: its objects, arrays, strings and
   * typed array buffers. 0 once freed. */
  readonly byteSize: number;
  /** Live and freed regions of the process and the bytes the live ones hold. */
  static stats(): { regions: number; freed: number; bytes: number };

  /** A handle to the region of a region object, e.g. to put it into a
   * transfer list. Does not change ownership. A thread has one handle per
   * region, so handles of the same region are `===`. */
  static of(value: object): Region;
  /** Whether `value` is an object of some region; never throws. */
  static isRegionObject(value: unknown): boolean;
}

interface RegionScope extends Disposable {
  /** Leaves the scope early; `using` calls it at the end of the block. */
  exit(): void;
}

interface RegionBorrow extends Disposable {
  release(): void;
}

/** Result of `spawn`: block with `join()` or wait with `await`. */
interface SpawnHandle<T> extends PromiseLike<T> {
  /** Blocks the calling thread until the task finishes. Prefer `await` on the
   * main thread. */
  join(): T;
}

/**
 * Runs `callback` in a pool worker. Variables it uses are found in its
 * closure: plain data is copied, region objects are moved and come back when
 * the task ends, frozen regions are shared, helper functions are sent as
 * source. Classes, eval and with are rejected.
 */
declare function spawn<Args extends (RegionData | Channel)[], Result extends RegionData | void>(
  callback: (...args: Args) => Result | PromiseLike<Result>,
  ...args: Args
): SpawnHandle<Result>;

declare namespace spawn {
  /** Number of pool workers, 4 by default. */
  let poolSize: number;
  /** Resolves once every task spawned by this thread has finished. */
  function idle(): Promise<void>;
}

/** What a receive gives: the value, or `done: true` once the channel is
 * closed and drained. */
type ChannelEntry<T> = { value: T; done: false } | { value: undefined; done: true };

/**
 * A channel between threads, like `chan T` in Go. A value sent into it moves
 * the regions it refers to directly (the sender loses access), shares frozen
 * regions and copies plain data. Channels can be captured by spawn() tasks,
 * sent with postMessage() and sent through other channels.
 */
declare class Channel<T = any> implements AsyncIterable<T>, Iterable<T> {
  /** `capacity` values fit into the buffer; 0 (the default) means every send
   * waits for a receiver. */
  constructor(capacity?: number);
  readonly capacity: number;
  /** Values in the buffer. */
  readonly size: number;
  readonly closed: boolean;

  /** Resolves once the value is in the buffer or taken by a receiver. Throws
   * if the channel is closed. */
  send(value: T): Promise<void>;
  /** Blocks the thread instead. Fine in workers; avoid on the main thread. */
  sendSync(value: T): void;
  recv(): Promise<ChannelEntry<T>>;
  recvSync(): ChannelEntry<T>;
  /** No more sends. Values already sent can still be received. */
  close(): void;

  /** `for await (const value of channel)` until it is closed. */
  [Symbol.asyncIterator](): AsyncIterator<T>;
  /** `for (const value of channel)`: blocking, for workers. */
  [Symbol.iterator](): Iterator<T>;

  /** Waits for the first channel that has a value or is closed. */
  static select<T>(
    channels: Iterable<Channel<T>>,
  ): Promise<{ channel: Channel<T>; value: T | undefined; done: boolean }>;
  static selectSync<T>(
    channels: Iterable<Channel<T>>,
  ): { channel: Channel<T>; value: T | undefined; done: boolean };
}

// --- d8 shell globals used together with regions ---------------------------

declare function print(...values: unknown[]): void;
/** Available with --expose-gc. */
declare function gc(): void;
declare function quit(code?: number): never;

declare const performance: { now(): number };

declare function setTimeout(callback: () => void, delay?: number): number;

interface D8WorkerOptions {
  /** 'string' treats the first argument as source code. */
  type?: 'string' | 'function' | 'classic';
}

/** d8's Worker. Unlike the browser one it has a blocking getMessage(). */
declare class Worker {
  constructor(source: string | (() => void), options?: D8WorkerOptions);
  /** Regions (or any object of a region) and ArrayBuffers in `transfer` move
   * to the worker. */
  postMessage(message: unknown, transfer?: (Region | ArrayBuffer | object)[]): void;
  /** Blocks until the worker posts a message (d8 only). */
  getMessage(): any;
  onmessage: ((event: { data: any }) => void) | null;
  terminate(): void;
}

/** Inside a worker: send a message to the parent. */
declare function postMessage(message: unknown, transfer?: (Region | ArrayBuffer | object)[]): void;
/** Inside a worker: messages from the parent. */
declare var onmessage: ((event: { data: any }) => void) | null;

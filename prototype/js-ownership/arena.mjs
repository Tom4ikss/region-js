import { threadId } from 'node:worker_threads';

const BUMP = 0;
const REGION_COUNT = 1;
const REGION_TABLE = 4;
const REGION_FIELDS = 4;
const OWNER = 0;
const TOP = 1;
const END = 2;
const MAX_REGIONS = 256;
const DATA_START = (REGION_TABLE + MAX_REGIONS * REGION_FIELDS) * 4;

export const align8 = (n) => (n + 7) & ~7;

export class OwnershipError extends Error {
    name = 'OwnershipError';
}

export class Arena {
    static create(byteLength) {
        const arena = new Arena(new SharedArrayBuffer(byteLength));
        arena.i32[BUMP] = DATA_START;
        return arena;
    }

    #regions = new Map();

    constructor(buffer) {
        this.buffer = buffer;
        this.i32 = new Int32Array(buffer);
        this.f64 = new Float64Array(buffer);
    }

    createRegion(byteLength) {
        const id = Atomics.add(this.i32, REGION_COUNT, 1);
        if (id >= MAX_REGIONS) {
            throw new RangeError('too many regions');
        }

        const size = align8(byteLength);
        const start = Atomics.add(this.i32, BUMP, size);
        if (start + size > this.buffer.byteLength) {
            throw new RangeError('arena is full');
        }

        const base = REGION_TABLE + id * REGION_FIELDS;
        this.i32[base + TOP] = start;
        this.i32[base + END] = start + size;
        Atomics.store(this.i32, base + OWNER, threadId);
        return this.region(id);
    }

    region(id) {
        let region = this.#regions.get(id);
        if (!region) {
            region = new Region(this, id);
            this.#regions.set(id, region);
        }
        return region;
    }
}

export class Region {
    constructor(arena, id) {
        this.arena = arena;
        this.id = id;
        this.base = REGION_TABLE + id * REGION_FIELDS;
    }

    // The atomic load pairs with the sender's compareExchange, so plain reads of
    // the region's data after a successful check see everything the sender wrote.
    check() {
        const owner = Atomics.load(this.arena.i32, this.base + OWNER);
        if (owner !== threadId) {
            throw new OwnershipError(
                `region ${this.id} is owned by thread ${owner}, not by thread ${threadId}`,
            );
        }
    }

    moveTo(targetThreadId) {
        const owner = Atomics.compareExchange(
            this.arena.i32,
            this.base + OWNER,
            threadId,
            targetThreadId,
        );
        if (owner !== threadId) {
            throw new OwnershipError(
                `thread ${threadId} cannot move region ${this.id}: it is owned by thread ${owner}`,
            );
        }
    }

    alloc(byteLength) {
        this.check();
        const { i32 } = this.arena;
        const ptr = i32[this.base + TOP];
        const top = ptr + align8(byteLength);
        if (top > i32[this.base + END]) {
            throw new RangeError(`region ${this.id} is full`);
        }
        i32[this.base + TOP] = top;
        return ptr;
    }
}

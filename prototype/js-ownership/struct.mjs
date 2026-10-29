import { align8, OwnershipError } from './arena.mjs';

const HEADER_BYTES = 8;
const KIND_BYTES = { f64: 8, i32: 4, ref: 4 };
const types = [];

export function defineStruct(name, layout) {
    const typeId = types.length + 1;

    class Struct {
        constructor(region, ptr) {
            this.region = region;
            this.ptr = ptr;
        }

        static create(region, init = {}) {
            const ptr = region.alloc(Struct.byteLength);
            const { i32 } = region.arena;
            i32[ptr >> 2] = region.id;
            i32[(ptr >> 2) + 1] = typeId;
            return Object.assign(new Struct(region, ptr), init);
        }
    }

    let offset = HEADER_BYTES;
    for (const [field, kind] of Object.entries(layout)) {
        const size = KIND_BYTES[kind];
        if (!size) {
            throw new TypeError(`${name}.${field}: unknown kind "${kind}"`);
        }
        offset = Math.ceil(offset / size) * size;
        Object.defineProperty(Struct.prototype, field, accessors(kind, offset));
        offset += size;
    }

    Object.defineProperty(Struct, 'name', { value: name });
    Struct.byteLength = align8(offset);
    types.push(Struct);
    return Struct;
}

export function wrap(region, ptr) {
    const Type = types[region.arena.i32[(ptr >> 2) + 1] - 1];
    return new Type(region, ptr);
}

function accessors(kind, offset) {
    switch (kind) {
        case 'f64':
            return {
                get() {
                    this.region.check();
                    return this.region.arena.f64[(this.ptr + offset) >> 3];
                },
                set(value) {
                    this.region.check();
                    this.region.arena.f64[(this.ptr + offset) >> 3] = value;
                },
            };
        case 'i32':
            return {
                get() {
                    this.region.check();
                    return this.region.arena.i32[(this.ptr + offset) >> 2];
                },
                set(value) {
                    this.region.check();
                    this.region.arena.i32[(this.ptr + offset) >> 2] = value;
                },
            };
        case 'ref':
            return {
                get() {
                    this.region.check();
                    const ptr = this.region.arena.i32[(this.ptr + offset) >> 2];
                    return ptr === 0 ? null : wrap(this.region, ptr);
                },
                set(value) {
                    this.region.check();
                    if (value !== null && value.region !== this.region) {
                        throw new OwnershipError(
                            `cross-region reference: region ${this.region.id} -> region ${value.region.id}`,
                        );
                    }
                    this.region.arena.i32[(this.ptr + offset) >> 2] = value === null ? 0 : value.ptr;
                },
            };
    }
}

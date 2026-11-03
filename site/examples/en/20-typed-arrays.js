// Typed arrays in a region.
const pixels = new Uint8Array([10, 20, 30, 40]);
const region = new Region();
const image = region.run(() => ({ width: 2, height: 2, pixels }));

// By default the array is copied into the region; the original stays ours.
image.pixels[0] = 99;
print('in the region:', image.pixels[0], '| original:', pixels[0]);

// Every read of the field gives a new view over the same region memory.
const view = image.pixels;
print('same object?', image.pixels === view, '| same bytes?', image.pixels[0] === view[0]);
print('an ordinary Uint8Array:', view instanceof Uint8Array, view.length);

// The field can be replaced with another array, even of a different length: it is copied too.
image.pixels = new Uint8Array(16);
print('new length:', image.pixels.length);

// transfer: the buffer moves into the region without a copy, and the original is detached.
const copySource = new Float64Array(1_000_000).fill(0.5);
let start = performance.now();
const copied = new Region().run(() => ({ samples: copySource }));
const copyMs = performance.now() - start;

const big = new Float64Array(1_000_000).fill(0.5);
start = performance.now();
const moved = new Region().run(() => ({ samples: big }), [big.buffer]);
const transferMs = performance.now() - start;

print(`8 MB by copy: ${copyMs.toFixed(2)} ms, by transfer: ${transferMs.toFixed(2)} ms`);
print('original after transfer:', big.length, '| in the region:', moved.samples.length, copied.samples.length);

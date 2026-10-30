// d8 --harmony-region-literals --module --expose-gc --verify-heap typed-born.js
// Region.typedArray() makes a typed array whose bytes belong to the region
// from the start: storing its view in the region copies nothing.
const expectError = (name, fn) => {
  try {
    print(`${name}: NO ERROR ->`, fn());
  } catch (e) {
    print(`${name}: ${e.name}: ${e.message}`);
  }
};

const region = new Region();
{
  using _ = region.enter();
  const before = region.byteSize;
  const samples = Region.typedArray(Float64Array, 1000);
  print('fresh view:', samples instanceof Float64Array, samples.length, samples[999],
        'bytes counted:', region.byteSize - before);
  for (let i = 0; i < samples.length; i++) samples[i] = i * 0.5;

  const afterFill = region.byteSize;
  const data = #{ samples, label: 'sensor' };
  print('stored without a copy:', region.byteSize - afterFill < 1000,
        data.samples[999]);
  // The same bytes: writes through the first view show through the field.
  samples[0] = 42;
  print('same bytes:', data.samples[0], data.samples !== samples);

  // A view of the region's bytes stays registered while it lives, also
  // across a garbage collection.
  const later = Region.typedArray(Int32Array, 4);
  later[3] = 7;
  gc();
  gc();
  const plainBox = region.byteSize;
  #{ later: 0 };
  const boxBytes = region.byteSize - plainBox;
  const afterGc = region.byteSize;
  const box = #{ later };
  later[0] = 9;
  print('after gc, still no copy:', region.byteSize - afterGc === boxBytes,
        box.later[0], box.later[3]);

  // run() reuses the bytes as well.
  const viaRun = region.run(() => ({ samples }));
  samples[1] = 43;
  print('run without a copy:', viaRun.samples[1]);

  // A subarray keeps its offset into the same bytes.
  const part = samples.subarray(10, 20);
  const withPart = #{ part };
  samples[10] = 44;
  print('subarray:', withPart.part.length, withPart.part[0]);
}

// Another region gets a copy: bytes belong to one region.
{
  const other = new Region();
  let view;
  {
    using _ = region.enter();
    view = Region.typedArray(Uint8Array, 3);
    view.set([1, 2, 3]);
  }
  using _ = other.enter();
  const copy = #{ view };
  view[0] = 100;
  print('other region copies:', copy.view[0], copy.view[2]);
}

// The view is a view of the region: it is detached when the region moves or
// freezes, like any view read from a region.
{
  const r = new Region();
  let view, data;
  {
    using _ = r.enter();
    view = r.typedArray(Float32Array, 8);
    view.fill(1.5);
    data = #{ view };
  }
  r.freeze();
  print('after freeze, our view:', view.length, 'the owner reads:', data.view[7]);
  r.thaw();
  const w = new Worker(`onmessage = ({ data }) => postMessage(data.view.reduce((a, b) => a + b, 0));`,
                       { type: 'string' });
  const fresh = data.view;
  w.postMessage(data, [r]);
  print('after move, our view:', fresh.length, 'the worker sums:', w.getMessage());
  w.terminate();
}

// Errors.
expectError('no current region', () => Region.typedArray(Float64Array, 1));
expectError('not a typed array constructor', () => region.typedArray(Array, 1));
expectError('negative length', () => region.typedArray(Uint8Array, -1));
expectError('huge length', () => region.typedArray(Float64Array, 2 ** 52));
{
  const r = new Region();
  r.freeze();
  expectError('frozen region', () => r.typedArray(Uint8Array, 1));
  r.thaw();
  r.free();
  expectError('freed region', () => r.typedArray(Uint8Array, 1));
}
print('empty:', region.typedArray(Uint8Array, 0).length);

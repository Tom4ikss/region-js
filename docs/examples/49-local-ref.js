// d8-flags: --module
// A reference from a region to an object of your own thread: Region.localRef.
const cache = new Map([['sku1', 120]]);

const region = new Region();
const order = region.run(() => ({ sku: 'sku1', count: 2, prices: Region.localRef(cache) }));

// In its own thread deref() returns the object itself.
print('here:', order.prices.local, order.prices.deref().get(order.sku) * order.count);

// The task gets the whole region, but the Map stays here: the task has the handle,
// but cannot dereference it.
const inTask = await spawn(() => {
  try {
    return order.prices.deref().size;
  } catch (e) {
    return `${order.prices.local} ${e.name} ${e.reason}`;
  }
});
print('in a task:', inTask);

// After the task the region is back here, and the handle works again.
print('back here:', order.prices.deref() === cache);

// The work behind the routes of the HTTP benchmark, the same for every
// server variant. The functions use nothing from outside, so spawn() can send
// them to a worker as source text.
'use strict';

const CATEGORIES = 1000;

// A catalog of `count` rows grouped by category: byCategory[c] is the rows of
// category c.
function buildCatalog(count) {
  const byCategory = [];
  for (let c = 0; c < 1000; c++) byCategory.push([]);
  for (let i = 0; i < count; i++) {
    byCategory[i % 1000].push({
      id: i,
      name: 'item ' + i,
      price: ((i * 7919) % 100000) / 100,
      stock: (i * 31) % 50,
      tags: ['a', 'b'],
    });
  }
  return { count, byCategory };
}

// The rows of one category that are in stock: their number, the price range
// and the five cheapest.
function query(catalog, category) {
  const rows = catalog.byCategory[category % 1000];
  const inStock = [];
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const row of rows) {
    if (row.stock === 0) continue;
    inStock.push(row);
    if (row.price < min) min = row.price;
    if (row.price > max) max = row.price;
    sum += row.price;
  }
  inStock.sort((a, b) => a.price - b.price);
  const cheapest = [];
  for (let i = 0; i < 5 && i < inStock.length; i++) {
    const row = inStock[i];
    cheapest.push({ id: row.id, name: row.name, price: row.price });
  }
  return { category, inStock: inStock.length, min, max, mean: sum / inStock.length, cheapest };
}

// About half a millisecond of CPU: a few thousand pseudo-random scores,
// sorted.
function compute(seed) {
  let x = (seed | 0) || 1;
  const items = [];
  for (let i = 0; i < 4000; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    items.push({ id: i, score: x % 100000 });
  }
  items.sort((a, b) => b.score - a.score);
  let sum = 0;
  for (const item of items) sum += item.score;
  return { top: items.slice(0, 10), mean: sum / items.length };
}

module.exports = { CATEGORIES, buildCatalog, query, compute };

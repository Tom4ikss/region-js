// The work behind the routes of the real-world benchmark, shared by every
// JavaScript server (Node, Bun and the region variants). The Go and Rust
// servers do the same in their own code.
//
// Routes:
//   /plaintext, /json        the TechEmpower plaintext and JSON tests
//   /db, /queries?n=         one and n random rows of `world`
//   /fortunes                the fortunes as an HTML table
//   /updates?n=              n random rows of `world` with new numbers
//   /search?c=&min=&max=&page=
//                            products of category c in stock with a price in
//                            [min, max], cheapest first, 20 per page, from the
//                            catalog in memory
//   /report?c=               5 categories from c on: counts per price bucket,
//                            the top brands by stock value and the 100 best
//                            rated products; a few milliseconds of CPU
'use strict';

const PAGE = 20;
const REPORT_CATEGORIES = 5;
const CATEGORIES = 1000;

const DB = {
  host: '127.0.0.1',
  port: 5432,
  database: 'bench',
  username: 'bench',
  password: 'bench',
};

function randomId() {
  return 1 + Math.floor(Math.random() * 10000);
}

function count(value) {
  const n = Number.parseInt(value, 10);
  if (!(n >= 1)) return 1;
  return n > 500 ? 500 : n;
}

function escapeHtml(text) {
  let out = '';
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    let rep;
    switch (text.charCodeAt(i)) {
      case 38: rep = '&amp;'; break;
      case 60: rep = '&lt;'; break;
      case 62: rep = '&gt;'; break;
      case 34: rep = '&quot;'; break;
      case 39: rep = '&#39;'; break;
      default: continue;
    }
    out += text.slice(last, i) + rep;
    last = i + 1;
  }
  return last === 0 ? text : out + text.slice(last);
}

function fortunesHtml(rows) {
  const list = rows.map((row) => ({ id: row.id, message: row.message }));
  list.push({ id: 0, message: 'Additional fortune added at request time.' });
  list.sort((a, b) => (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
  let html = '<!DOCTYPE html><html><head><title>Fortunes</title></head><body><table><tr><th>id</th><th>message</th></tr>';
  for (const row of list) {
    html += '<tr><td>' + row.id + '</td><td>' + escapeHtml(row.message) + '</td></tr>';
  }
  return html + '</table></body></html>';
}

// Database access through a postgres.js-style `sql` (postgres.js in Node,
// Bun.sql in Bun): both take tagged templates and sql.unsafe(text, params).
function database(sql) {
  const one = async (id) => (await sql`SELECT id, randomnumber AS "randomNumber" FROM world WHERE id = ${id}`)[0];
  return {
    one: () => one(randomId()),
    many: (n) => Promise.all(Array.from({ length: n }, () => one(randomId()))),
    async fortunes() {
      return fortunesHtml(await sql`SELECT id, message FROM fortune`);
    },
    async updates(n) {
      const rows = await Promise.all(Array.from({ length: n }, () => one(randomId())));
      // Distinct ids in order, so that concurrent updates take row locks in
      // the same order and do not deadlock.
      const byId = new Map();
      for (const row of rows) {
        row.randomNumber = randomId();
        byId.set(row.id, row.randomNumber);
      }
      const ids = [...byId.keys()].sort((a, b) => a - b);
      const params = [];
      const values = ids.map((id, i) => {
        params.push(id, byId.get(id));
        return `($${2 * i + 1}::int, $${2 * i + 2}::int)`;
      });
      await sql.unsafe(
        `UPDATE world SET randomnumber = v.r FROM (VALUES ${values.join(', ')}) AS v(id, r) WHERE world.id = v.id`,
        params);
      return rows;
    },
  };
}

async function loadProducts(sql) {
  const rows = await sql`SELECT id, name, category, price::float8 AS price, stock, rating, brand FROM product ORDER BY id`;
  return rows;
}

// byCategory[c] is the products of category c in id order.
function buildCatalog(rows) {
  const byCategory = [];
  for (let c = 0; c < CATEGORIES; c++) byCategory.push([]);
  for (const r of rows) {
    byCategory[r.category].push({
      id: r.id, name: r.name, category: r.category, price: r.price,
      stock: r.stock, rating: r.rating, brand: r.brand,
    });
  }
  return { byCategory };
}

function search(catalog, query) {
  const c = (Number.parseInt(query.c, 10) || 0) % CATEGORIES;
  const min = Number(query.min ?? 0) || 0;
  const max = query.max === undefined ? Infinity : Number(query.max);
  const page = Math.max(0, Number.parseInt(query.page, 10) || 0);
  const found = [];
  for (const p of catalog.byCategory[c]) {
    if (p.stock > 0 && p.price >= min && p.price <= max) found.push(p);
  }
  found.sort((a, b) => a.price - b.price || a.id - b.id);
  const items = [];
  for (let i = page * PAGE; i < found.length && i < (page + 1) * PAGE; i++) {
    const p = found[i];
    items.push({ id: p.id, name: p.name, price: p.price, stock: p.stock, rating: p.rating });
  }
  return { category: c, total: found.length, page, items };
}

function report(catalog, query) {
  const first = (Number.parseInt(query.c, 10) || 0) % CATEGORIES;
  const buckets = [];
  for (let i = 0; i < 100; i++) buckets.push({ count: 0, sum: 0, min: Infinity, max: -Infinity });
  const brands = new Map();
  const all = [];
  for (let k = 0; k < REPORT_CATEGORIES; k++) {
    for (const p of catalog.byCategory[(first + k) % CATEGORIES]) {
      const b = buckets[Math.min(99, Math.floor(p.price / 10))];
      b.count++;
      b.sum += p.price;
      if (p.price < b.min) b.min = p.price;
      if (p.price > b.max) b.max = p.price;
      brands.set(p.brand, (brands.get(p.brand) ?? 0) + p.price * p.stock);
      all.push(p);
    }
  }
  all.sort((a, b) => b.rating - a.rating || a.price - b.price || a.id - b.id);
  const best = [];
  for (let i = 0; i < 100 && i < all.length; i++) {
    const p = all[i];
    best.push({ id: p.id, name: p.name, price: p.price, rating: p.rating });
  }
  const topBrands = [...brands].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([brand, value]) => ({ brand, value: Math.round(value * 100) / 100 }));
  return {
    first,
    products: all.length,
    buckets: buckets.map((b, i) => ({
      bucket: i, count: b.count, mean: Math.round((b.sum / b.count) * 100) / 100, min: b.min, max: b.max,
    })).filter((b) => b.count > 0),
    topBrands,
    best,
  };
}

module.exports = {
  DB, PAGE, CATEGORIES, randomId, count, escapeHtml, fortunesHtml, database,
  loadProducts, buildCatalog, search, report,
};

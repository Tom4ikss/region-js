// A piscina worker for the fastify-piscina variant of server.js: every
// worker builds its own copy of the catalog.
'use strict';
const { buildCatalog, query, compute } = require('./work');

const catalog = buildCatalog(Number(process.env.CATALOG_ROWS ?? 1e6));

module.exports = ({ route, arg }) => {
  if (route === 'compute') return compute(arg);
  if (route === 'catalog') return query(catalog, arg);
  return 0;
};

import noFloatingBorrowWhile from './rules/no-floating-borrow-while.mjs';
import noFloatingSpawn from './rules/no-floating-spawn.mjs';
import noRegionUseWhileSpawned from './rules/no-region-use-while-spawned.mjs';

const plugin = {
  meta: { name: 'eslint-plugin-regions', version: '0.1.0' },
  rules: {
    'no-floating-borrow-while': noFloatingBorrowWhile,
    'no-floating-spawn': noFloatingSpawn,
    'no-region-use-while-spawned': noRegionUseWhileSpawned,
  },
};

plugin.configs = {
  recommended: {
    plugins: { regions: plugin },
    rules: {
      'regions/no-floating-borrow-while': 'error',
      'regions/no-floating-spawn': 'warn',
      'regions/no-region-use-while-spawned': 'error',
    },
  },
};

export default plugin;

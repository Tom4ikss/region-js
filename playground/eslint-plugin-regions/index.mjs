import noAwaitHoldingGuard from './rules/no-await-holding-guard.mjs';
import noFloatingBorrowWhile from './rules/no-floating-borrow-while.mjs';
import noFloatingSpawn from './rules/no-floating-spawn.mjs';
import noGuardValueEscape from './rules/no-guard-value-escape.mjs';
import noRegionUseWhileSpawned from './rules/no-region-use-while-spawned.mjs';
import noStaleRegionCheck from './rules/no-stale-region-check.mjs';
import noUseAfterSend from './rules/no-use-after-send.mjs';
import noWriteToSpawnCopy from './rules/no-write-to-spawn-copy.mjs';

const plugin = {
  meta: { name: 'eslint-plugin-regions', version: '0.2.0' },
  rules: {
    'no-await-holding-guard': noAwaitHoldingGuard,
    'no-floating-borrow-while': noFloatingBorrowWhile,
    'no-floating-spawn': noFloatingSpawn,
    'no-guard-value-escape': noGuardValueEscape,
    'no-region-use-while-spawned': noRegionUseWhileSpawned,
    'no-stale-region-check': noStaleRegionCheck,
    'no-use-after-send': noUseAfterSend,
    'no-write-to-spawn-copy': noWriteToSpawnCopy,
  },
};

plugin.configs = {
  recommended: {
    plugins: { regions: plugin },
    rules: {
      'regions/no-await-holding-guard': 'warn',
      'regions/no-floating-borrow-while': 'error',
      'regions/no-floating-spawn': 'warn',
      'regions/no-guard-value-escape': 'error',
      'regions/no-region-use-while-spawned': 'error',
      'regions/no-stale-region-check': 'warn',
      'regions/no-use-after-send': 'error',
      'regions/no-write-to-spawn-copy': 'error',
    },
  },
};

export default plugin;

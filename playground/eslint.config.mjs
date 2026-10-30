import regions from './eslint-plugin-regions/index.mjs';

export default [
  // #{} literals are not JavaScript that ESLint can parse yet.
  { ignores: ['experimental/**', 'vscode-region-literals/**'] },
  {
    files: ['examples/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    ...regions.configs.recommended,
  },
];

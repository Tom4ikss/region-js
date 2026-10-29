import regions from './eslint-plugin-regions/index.mjs';

export default [
  {
    files: ['examples/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    ...regions.configs.recommended,
  },
];

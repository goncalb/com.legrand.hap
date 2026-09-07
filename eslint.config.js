'use strict';
const js = require('@eslint/js');
const globals = require('globals');

const rules = {
  'no-shadow': 'error',
  'no-redeclare': 'error',
  'no-use-before-define': ['error', { functions: false, variables: false }],
  'no-unused-vars': ['warn', { args: 'none' }],
  'prefer-const': 'warn',
};

module.exports = [
  { ignores: ['node_modules/**', '.homeybuild/**', '.lint-tmp/**'] },
  {
    files: ['**/*.js'],
    ignores: ['.lint-tmp/**'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { ...js.configs.recommended.rules, ...rules },
  },
  {
    // inline <script> blocks extracted from HTML by scripts/lint-html.js
    files: ['.lint-tmp/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, Homey: 'readonly' } },
    rules: { ...js.configs.recommended.rules, ...rules, 'no-unused-vars': 'off' },
  },
];

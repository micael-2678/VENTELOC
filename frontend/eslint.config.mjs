import js from '@eslint/js';
import react from 'eslint-plugin-react';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default [
  js.configs.recommended,
  { ignores: ['build/**', 'node_modules/**', 'plugins/**'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    plugins: { react, 'jsx-a11y': jsxA11y },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    settings: { react: { version: '19.0' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...jsxA11y.configs.recommended.rules,
      'react/prop-types': 'off',
      // Apostrophes françaises dans le JSX existant : règle purement stylistique
      'react/no-unescaped-entities': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.{js,jsx}', 'src/setupTests.js', 'src/components/shared/jestEnv.js'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
  },
];

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Layer boundaries (see CLAUDE.md). Imports are always relative, so the
// patterns match any path that goes through a `render`, `ui` or `core` folder.
const three = { group: ['three', 'three/*'], message: 'Three.js is only allowed in src/render.' };
const render = { group: ['**/render', '**/render/**'], message: 'This layer may not import src/render.' };
const ui = { group: ['**/ui', '**/ui/**'], message: 'This layer may not import src/ui.' };
const core = { group: ['**/core', '**/core/**'], message: 'src/shared may not import src/core.' };

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'public/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/core/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [three, render, ui] }] },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [three, render, ui, core] }] },
  },
  {
    files: ['src/render/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [ui] }] },
  },
  {
    files: ['src/ui/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [three] }] },
  },
  {
    // the turn worker runs outside the page: rules and shared code only
    files: ['src/ui/turnWorker.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [three, render, { group: ['./*'], message: 'The turn worker may import src/core and src/shared only.' }] },
      ],
    },
  },
  {
    // tests index into arrays whose contents they have just asserted
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['src/render/**/*.ts', 'src/ui/**/*.ts', 'src/main.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['tools/**/*.ts', '*.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
);

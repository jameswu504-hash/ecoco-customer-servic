import globals from 'globals';

const sourceFiles = [
  'server.js',
  'knowledge.js',
  'eslint.config.mjs',
  '{config,db,middleware,routes,services,scripts,public,tests,skills,.agents}/**/*.{js,mjs}',
];

export default [
  {
    ignores: ['node_modules/**', 'data/**', 'docs/**'],
  },
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['public/index.js'],
    languageOptions: {
      globals: {
        DOMPurify: 'readonly',
        marked: 'readonly',
      },
    },
  },
];

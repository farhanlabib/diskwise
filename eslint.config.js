// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const NO_NETWORK_MESSAGE = 'diskwise makes no outbound network calls (PLAN §5.11)';

const outboundNetworkModules = [
  { name: 'https', message: NO_NETWORK_MESSAGE },
  { name: 'node:https', message: NO_NETWORK_MESSAGE },
  { name: 'net', message: NO_NETWORK_MESSAGE },
  { name: 'node:net', message: NO_NETWORK_MESSAGE },
  { name: 'dgram', message: NO_NETWORK_MESSAGE },
  { name: 'node:dgram', message: NO_NETWORK_MESSAGE },
  { name: 'undici', message: NO_NETWORK_MESSAGE },
  { name: 'http2', message: NO_NETWORK_MESSAGE },
  { name: 'node:http2', message: NO_NETWORK_MESSAGE },
  { name: 'tls', message: NO_NETWORK_MESSAGE },
  { name: 'node:tls', message: NO_NETWORK_MESSAGE },
  { name: 'http', message: NO_NETWORK_MESSAGE },
  { name: 'node:http', message: NO_NETWORK_MESSAGE },
];

// packages/server may create a loopback-only server, so http is allowed there.
const serverModules = outboundNetworkModules.filter(
  (module) => module.name !== 'http' && module.name !== 'node:http',
);

const SHELL_EXEC_MESSAGE = 'use execFile with an argv array, never a shell';

const shellExecSelectors = [
  { selector: "CallExpression[callee.name='exec']", message: SHELL_EXEC_MESSAGE },
  { selector: "CallExpression[callee.name='execSync']", message: SHELL_EXEC_MESSAGE },
  {
    selector: "CallExpression[callee.property.name='exec'][callee.object.name='child_process']",
    message: SHELL_EXEC_MESSAGE,
  },
];

const bannedGlobals = [
  { name: 'fetch', message: NO_NETWORK_MESSAGE },
  { name: 'WebSocket', message: NO_NETWORK_MESSAGE },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'design/**',
      'packages/native-helper/.build/**',
      '**/__snapshots__/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: outboundNetworkModules }],
      'no-restricted-syntax': ['error', ...shellExecSelectors],
      'no-restricted-globals': ['error', ...bannedGlobals],
    },
  },
  {
    files: ['packages/server/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: serverModules }],
    },
  },
  {
    // The UI talks to its own loopback server, so fetch is allowed there.
    files: ['packages/ui/**'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    // Playwright specs and config run in Node, not in the bundled app.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
);

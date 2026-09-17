import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  // Workspace packages export TypeScript source, so they are bundled into the CLI.
  noExternal: [/^@diskwise\//],
});

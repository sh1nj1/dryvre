import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  outDir: '../../dist/mcp',
  banner: { js: '#!/usr/bin/env node' },
  noExternal: ['@dryvre/shared'],
});

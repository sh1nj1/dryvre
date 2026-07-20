import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/app.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  outDir: '../../dist/server',
  noExternal: ['@dryvre/db', '@dryvre/shared'],
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    hookTimeout: 300_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});

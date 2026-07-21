import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/demo',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5273',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    env: {
      DRYVRE_DB_MODE: 'container',
      DRYVRE_AGENT_FAKE: 'true',
      VITE_MOCK_DATA_ONLY: 'false',
      PORT: '3100',
      VITE_DEV_PORT: '5273',
      VITE_DEV_HOST: '127.0.0.1',
      VITE_DEV_API_TARGET: 'http://127.0.0.1:3100',
    },
    url: 'http://127.0.0.1:5273/app',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});

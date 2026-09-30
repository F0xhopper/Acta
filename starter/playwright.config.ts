import { defineConfig, devices } from '@playwright/test';

const port = 3417;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: 'mobile', use: { ...devices['iPhone 13'] } }],
  webServer: { command: `pnpm exec next start -p ${port}`, url: `http://localhost:${port}`, reuseExistingServer: false, timeout: 120000 },
  reporter: [['list']],
});

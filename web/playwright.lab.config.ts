import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './test/protocol-lab',
  testMatch: '**/*.spec.ts',
  timeout: 45000,
  workers: 1,
  use: { baseURL: process.env.LAB_BASE_URL || 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  reporter: [['list']],
  outputDir: '../work/protocol-lab/browser-results',
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: process.env.LAB_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 3100',
        url: 'http://127.0.0.1:3100/benchmarks',
        reuseExistingServer: true,
        timeout: 120000,
      },
})

import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './test/enterprise',
  timeout: 90000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3120', trace: 'retain-on-failure' },
  reporter: [
    ['list'],
    ['json', { outputFile: '../work/enterprise/browser.json' }],
  ],
  outputDir: '../work/enterprise/browser-results',
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
})

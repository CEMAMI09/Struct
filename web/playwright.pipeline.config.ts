import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './test/pipelines',
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: process.env.PIPELINE_BASE_URL || 'http://127.0.0.1:3108',
    trace: 'retain-on-failure',
  },
  reporter: [
    ['list'],
    ['json', { outputFile: '../work/pipelines/browser.json' }],
  ],
  outputDir: '../work/pipelines/browser-results',
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
})

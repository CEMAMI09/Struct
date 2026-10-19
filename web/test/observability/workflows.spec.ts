import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
async function login(page: Page, path: string) {
  await page.goto('/login?redirect=' + encodeURIComponent(path))
  await page.getByLabel('Email', { exact: true }).fill('local@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 }).last()).toBeVisible()
  await page.getByText('Filters and display settings', { exact: true }).click()
}
test('real monitoring API, inventory, policies, documentation and responsive layout', async ({
  page,
}, info) => {
  await login(page, '/dashboard/monitoring')
  const region = page.getByRole('region', { name: 'Device health inventory' })
  await expect(region).toContainText('Local sender')
  await expect(region).toContainText('Inactive fixture')
  await expect(region).toContainText('Never fixture')
  await region
    .getByRole('row')
    .filter({ hasText: 'Inactive fixture' })
    .getByRole('button', { name: 'Health / policy' })
    .click()
  await page
    .getByRole('combobox', { name: 'Reporting mode', exact: true })
    .selectOption('event')
  await page
    .getByRole('button', { name: 'Save device policy', exact: true })
    .click()
  await expect(
    region.getByRole('row').filter({ hasText: 'Inactive fixture' }),
  ).toContainText('Event-driven')
  await page
    .getByRole('combobox', { name: 'Attention', exact: true })
    .selectOption('errors')
  await expect(region).toContainText('No devices match this view.')
  await page
    .getByRole('combobox', { name: 'Attention', exact: true })
    .selectOption('')
  await expect(region).toContainText('Local sender')
  const width = await page.evaluate(() => ({
    actual: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }))
  expect(width.actual).toBeLessThanOrEqual(width.viewport + 2)
  await page
    .getByRole('heading', { name: 'Fleet monitoring', exact: true })
    .scrollIntoViewIfNeeded()
  if (
    await page.getByLabel('Device ID (optional)', { exact: true }).isVisible()
  )
    await page
      .getByText('Filters and display settings', { exact: true })
      .click()
  await page.screenshot({
    path: `../docs/phase-5-8/evidence/monitoring-${info.project.name}.png`,
  })
  await page.getByRole('link', { name: 'View guide', exact: true }).click()
  await expect(
    page.getByRole('heading', {
      name: 'Monitoring, alerts and usage analytics',
      exact: true,
    }),
  ).toBeVisible()
})
test('actual rule evaluation, durable incident, acknowledgment and preferences', async ({
  page,
}, info) => {
  await login(page, '/dashboard/alerts')
  const name = 'Traffic ' + info.project.name
  await page.getByRole('button', { name: 'Add rule', exact: true }).click()
  await page.getByLabel('Rule name', { exact: true }).fill(name)
  await page
    .getByRole('combobox', { name: 'Condition', exact: true })
    .selectOption('bytes')
  await page.getByLabel('Trigger threshold', { exact: true }).fill('1')
  await page
    .getByLabel('Clear threshold (hysteresis)', { exact: true })
    .fill('0')
  await page.getByLabel('Enable automatic evaluation', { exact: true }).check()
  await page.getByRole('button', { name: 'Save rule', exact: true }).click()
  const incidents = page.getByRole('region', { name: 'Alert incidents' })
  await expect
    .poll(
      async () => {
        await page.getByRole('button', { name: 'Refresh', exact: true }).click()
        return incidents.innerText()
      },
      { timeout: 15000 },
    )
    .toContain(name)
  const incident = incidents.locator('article').filter({ hasText: name })
  await incident
    .getByRole('button', { name: 'Acknowledge', exact: true })
    .click()
  await expect(incident).toContainText('acknowledged')
  await page
    .getByLabel('Email me when configured rules trigger or recover', {
      exact: true,
    })
    .check()
  await page
    .getByRole('button', { name: 'Save email preferences', exact: true })
    .click()
  await page.reload()
  await expect(
    page.getByLabel('Email me when configured rules trigger or recover', {
      exact: true,
    }),
  ).toBeChecked()
  await page
    .getByLabel('Email me when configured rules trigger or recover', {
      exact: true,
    })
    .uncheck()
  await page
    .getByRole('button', { name: 'Save email preferences', exact: true })
    .click()
  page.once('dialog', (d) => d.accept())
  await incident
    .getByRole('button', { name: 'Resolve manually', exact: true })
    .click()
  await page
    .getByRole('combobox', { name: 'Incident view', exact: true })
    .selectOption('history')
  await expect(incident).toContainText('resolved')
})
test('observed usage, schema sample comparison, explicit costs and persisted assumptions', async ({
  page,
}, info) => {
  const f = await (
    await page.request.get('http://127.0.0.1:3125/__fixture')
  ).json()
  await login(page, '/dashboard/analytics?device=' + f.device)
  await expect(
    page.getByLabel('Device ID (optional)', { exact: true }),
  ).toHaveValue(f.device)
  await expect(page.getByText('26 B', { exact: true }).first()).toBeVisible()
  await page
    .getByRole('button', { name: 'Inspect latest device sample', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: 'Efficiency insights' }),
  ).toContainText('1 B/reading')
  await expect(
    page.getByRole('region', { name: 'Efficiency insights' }),
  ).toContainText('Protobuf')
  await expect(
    page.getByRole('region', { name: 'Efficiency insights' }),
  ).toContainText('Lossless schema packing')
  const pendingDownload = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download usage JSON', exact: true })
    .click()
  const download = await pendingDownload
  expect(download.suggestedFilename()).toBe('struct-usage.json')
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(exported.usage.buckets[0].application).toBe('26')
  expect(JSON.stringify(exported)).not.toContain('root_secret')
  await page
    .getByText('Optional connectivity cost estimate', { exact: true })
    .click()
  await page.getByLabel('Cost per decimal MB', { exact: true }).fill('1')
  await page
    .getByLabel('Measured carrier bytes/period (optional)', { exact: true })
    .fill('1000000')
  await page
    .getByLabel('Measured baseline bytes/period (optional)', { exact: true })
    .fill('2000000')
  await expect(
    page.getByRole('group', { name: 'Connectivity cost model' }),
  ).toContainText('Potential estimated savings: USD 1.00')
  await page
    .getByRole('button', {
      name: 'Save cost assumptions and time zone',
      exact: true,
    })
    .click()
  await page.reload()
  await page
    .getByText('Optional connectivity cost estimate', { exact: true })
    .click()
  await expect(
    page.getByLabel('Cost per decimal MB', { exact: true }),
  ).toHaveValue('1')
  await page
    .getByRole('combobox', { name: 'Billing', exact: true })
    .selectOption({ label: 'Flat rate' })
  await expect(
    page.getByRole('group', { name: 'Connectivity cost model' }),
  ).toContainText('Savings unavailable')
  await page
    .getByRole('heading', { name: 'Usage analytics', exact: true })
    .scrollIntoViewIfNeeded()
  if (
    await page.getByLabel('Device ID (optional)', { exact: true }).isVisible()
  )
    await page
      .getByText('Filters and display settings', { exact: true })
      .click()
  await page.screenshot({
    path: `../docs/phase-5-8/evidence/analytics-${info.project.name}.png`,
  })
  await page.getByText('Filters and display settings', { exact: true }).click()
  await page
    .getByLabel('Device ID (optional)', { exact: true })
    .fill('invalid-device')
  await page.getByLabel('Device ID (optional)', { exact: true }).press('Tab')
  await expect(page.getByRole('alert')).toBeVisible()
})

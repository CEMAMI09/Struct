import { test, expect, type Page } from '@playwright/test'
async function login(page: Page) {
  await page.goto('/login?redirect=%2Fdashboard%2Fdevices')
  await page.getByLabel('Email', { exact: true }).fill('local@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Devices', exact: true }).last(),
  ).toBeVisible()
}
async function confirm(page: Page) {
  const details = page.getByRole('region', { name: 'Job details' })
  await details.getByRole('checkbox').check()
  await details
    .getByRole('button', { name: 'Confirm operation', exact: true })
    .click()
  await expect(details.getByRole('heading')).toContainText('completed', {
    timeout: 45000,
  })
}
test('real API → SQL → worker fleet creation, selection, disable and group membership', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await login(page)
  const group = `Factory ${info.project.name}`,
    prefix = `browser-${info.project.name}-`
  await page
    .getByRole('textbox', { name: 'Group name', exact: true })
    .fill(group)
  await page.getByRole('button', { name: 'Create group', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Device groups' }),
  ).toContainText(group)
  await page.getByRole('button', { name: 'Add devices', exact: true }).click()
  await page.getByLabel('Name prefix', { exact: true }).fill(prefix)
  await page.getByLabel('Quantity', { exact: true }).fill('55')
  await page
    .getByRole('region', { name: 'Bulk configuration' })
    .getByLabel(group, { exact: true })
    .check()
  await page
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click()
  await expect(page.getByRole('region', { name: 'Job details' })).toContainText(
    '55 pending',
  )
  await confirm(page)
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  await page.getByLabel('Search', { exact: true }).fill(prefix)
  await expect(
    page.getByRole('region', { name: 'Device inventory' }),
  ).toContainText('55 devices')
  await page
    .getByRole('checkbox', { name: 'Select current page', exact: true })
    .check()
  await expect(
    page.getByRole('region', { name: 'Bulk actions' }),
  ).toContainText('50 selected')
  await page
    .getByRole('button', { name: 'Select all 55 matching', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Configure and preview', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click()
  await confirm(page)
  await page
    .getByLabel('Activity / authorization', { exact: true })
    .selectOption('disabled')
  await expect(
    page.getByRole('region', { name: 'Device inventory' }),
  ).toContainText('55 devices')
  await expect(
    page.getByRole('region', { name: 'Device inventory' }),
  ).toContainText('Disabled')
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  await page.evaluate(() =>
    document
      .querySelector('.overflow-y-auto.overflow-x-hidden')
      ?.scrollTo(0, 0),
  )
  await page.screenshot({
    path: `../docs/phase-6/evidence/fleet-${info.project.name}.png`,
    fullPage: true,
  })
  expect(errors).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('bulk tags and metadata, date filters and published fleet guides', async ({
  page,
}, info) => {
  await login(page)
  await page
    .getByLabel('Search', { exact: true })
    .fill(`browser-${info.project.name}-001`)
  const inventory = page.getByRole('region', { name: 'Device inventory' })
  await expect(inventory).toContainText('1 devices')
  await inventory.getByRole('checkbox', { name: 'Select current page' }).check()
  await page
    .getByRole('combobox', { name: 'Bulk operation' })
    .selectOption('labels_add')
  await page
    .getByRole('button', { name: 'Configure and preview', exact: true })
    .click()
  await page
    .getByRole('region', { name: 'Bulk configuration' })
    .getByLabel('Tags', { exact: true })
    .fill('factory-tested')
  await page
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click()
  await confirm(page)
  await expect(inventory).toContainText('factory-tested')
  await inventory.getByRole('checkbox', { name: 'Select current page' }).check()
  await page
    .getByRole('combobox', { name: 'Bulk operation' })
    .selectOption('metadata')
  await page
    .getByRole('button', { name: 'Configure and preview', exact: true })
    .click()
  const config = page.getByRole('region', { name: 'Bulk configuration' })
  await config
    .getByLabel('Description', { exact: true })
    .fill('Factory inspected')
  await config
    .getByLabel('Metadata JSON (replaces existing metadata)', { exact: true })
    .fill('{"serial_value":"9223372036854775807"}')
  await page
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click()
  await confirm(page)
  if (info.project.name === 'desktop') {
    await inventory
      .getByRole('checkbox', { name: 'Select current page' })
      .check()
    const download = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Export metadata', exact: true })
      .click()
    const report = await download
    const text = (await import('node:fs')).readFileSync(
      (await report.path())!,
      'utf8',
    )
    expect(text).toContain('Factory inspected')
    expect(text).toContain('9223372036854775807')
    expect(text).not.toContain('root_secret')
  }
  await page.getByText('Created / last-seen dates', { exact: true }).click()
  await page
    .getByLabel('Created after', { exact: true })
    .fill('2100-01-01T00:00')
  await expect(inventory).toContainText('0 devices')
  await page.getByLabel('Created after', { exact: true }).fill('')
  await expect(inventory).toContainText('1 devices')
  for (const [slug, title] of [
    ['fleet-management', 'Fleet device management'],
    ['fleet-csv', 'CSV fleet importing'],
    ['fleet-provisioning', 'Secure fleet provisioning and credentials'],
    ['fleet-api', 'Fleet API and operations'],
  ]) {
    await page.goto('/docs/' + slug)
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible()
  }
})
test('CSV mapping, result export and explicit one-time private provisioning', async ({
  page,
}, info) => {
  await login(page)
  await page.getByRole('button', { name: 'Add devices', exact: true }).click()
  await page.getByLabel('Input method', { exact: true }).selectOption('csv')
  const csv = `title,serial,tag\n温度-${info.project.name},SN-${info.project.name}-1,outdoor\nMeter-${info.project.name},SN-${info.project.name}-2,testing`
  await page.locator('input[type=file]').setInputFiles({
    name: 'fleet.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  const config = page.getByRole('region', { name: 'Bulk configuration' })
  await config.getByLabel('title →', { exact: true }).selectOption('name')
  await config
    .getByLabel('serial →', { exact: true })
    .selectOption('serial_number')
  await config.getByLabel('tag →', { exact: true }).selectOption('tags')
  await expect(config).toContainText('2 rows · 2 valid · 0 invalid')
  await page
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click()
  await confirm(page)
  const details = page.getByRole('region', { name: 'Job details' })
  const reportDownload = page.waitForEvent('download')
  await details.getByRole('button', { name: 'Download result report' }).click()
  const report = await reportDownload
  expect(report.suggestedFilename()).toBe('struct-job-results.csv')
  page.once('dialog', (d) => d.accept())
  const privateDownload = page.waitForEvent('download')
  await details
    .getByRole('button', {
      name: 'Download private manifest for this result page',
    })
    .click()
  const manifest = await privateDownload
  expect(manifest.suggestedFilename()).toBe('struct-private-provisioning.json')
  page.once('dialog', (d) => d.accept())
  await details
    .getByRole('button', {
      name: 'Download private manifest for this result page',
    })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'provisioning already exported',
  )
})
test('invalid values fail visibly and keyboard navigation remains usable', async ({
  page,
}) => {
  await login(page)
  await page.getByRole('button', { name: 'Add devices', exact: true }).click()
  await page.getByLabel('Quantity', { exact: true }).fill('10001')
  await page
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText('Quantity must be')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    'BODY',
  )
})

test('a lost preview response reuses the durable request identity', async ({
  page,
}, info) => {
  await login(page)
  await page.getByRole('button', { name: 'Add devices', exact: true }).click()
  const prefix = `ambiguous-${info.project.name}-`
  await page.getByLabel('Name prefix', { exact: true }).fill(prefix)
  await page.getByLabel('Quantity', { exact: true }).fill('1')
  const requests: string[] = [],
    jobs: string[] = []
  await page.route('**/api/fleet/preview', async (route) => {
    requests.push(route.request().postDataJSON().requestId)
    const response = await route.fetch()
    jobs.push((await response.json()).jobId)
    if (requests.length === 1) await route.abort('failed')
    else await route.fulfill({ response })
  })
  await page
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click()
  await expect(page.getByRole('region', { name: 'Job details' })).toContainText(
    '1 pending',
  )
  expect(requests.length).toBe(2)
  expect(requests[0]).toBe(requests[1])
  expect(jobs[0]).toBe(jobs[1])
  await confirm(page)
})

test('group rename/delete preserves devices and older device setup remains reachable', async ({
  page,
}, info) => {
  await login(page)
  const region = page.getByRole('region', { name: 'Device groups' }),
    name = `Factory ${info.project.name}`
  await region
    .getByRole('listitem')
    .filter({ hasText: name + ' ·' })
    .getByRole('button', { name: 'Rename', exact: true })
    .click()
  await region
    .getByRole('textbox', { name: 'Group name', exact: true })
    .fill(name + ' renamed')
  await region.getByRole('button', { name: 'Save group', exact: true }).click()
  await expect(region).toContainText(name + ' renamed')
  page.once('dialog', (d) => d.accept())
  await region
    .getByRole('listitem')
    .filter({ hasText: name + ' renamed ·' })
    .getByRole('button', { name: 'Delete group', exact: true })
    .click()
  await expect(region).not.toContainText(name + ' renamed')
  await page
    .getByLabel('Search', { exact: true })
    .fill(`browser-${info.project.name}-`)
  await expect(
    page.getByRole('region', { name: 'Device inventory' }),
  ).toContainText('55 devices')
  const fixture = await (
    await page.request.get('http://127.0.0.1:3125/__fixture')
  ).json()
  await page.goto('/dashboard/getting-started?device=' + fixture.device)
  await expect(
    page.getByRole('link', { name: 'Configure schema', exact: true }),
  ).toHaveAttribute('href', '/dashboard/schema?device=' + fixture.device)
  await page.goto('/dashboard/devices?create=1')
  await expect(
    page.getByRole('region', { name: 'Bulk configuration' }),
  ).toBeVisible()
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('1')
})

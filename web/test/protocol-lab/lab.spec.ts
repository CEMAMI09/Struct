import { test, expect } from '@playwright/test'
import { defaults } from '../../shared/protocol-lab/config'
async function ready(page: any) {
  await page.goto('/benchmarks')
  await expect(page.getByTestId('struct-effective')).toHaveText('56 B')
  await page.getByRole('button',{name:'Advanced results',exact:true}).click()
  const settings = page.getByRole('button', { name: 'Edit schema & settings' })
  if (await settings.isVisible()) await settings.click()
}
async function settled(page: any) {
  await expect(page.getByText('Updating results…', { exact: true })).toHaveCount(0)
}
test('editable schema, precision, delivery, batching and IP behavior', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await ready(page)
  await page.getByLabel('Precision', { exact: true }).selectOption('optimized')
  await expect(page.getByTestId('struct-payload')).toHaveText('3 B')
  await expect(page.getByTestId('struct-networkUp')).toHaveText('56 B')
  await expect(page.getByText(/humidity: 61.25 becomes 61.3/)).toBeVisible()
  await page.getByLabel('Delivery', { exact: true }).selectOption('confirmed')
  await expect(page.getByTestId('struct-exchange')).toHaveText('105 B')
  await page.getByRole('button', { name: 'Add field' }).click()
  await expect(page.getByTestId('struct-payload')).toHaveText('7 B')
  await page.getByRole('button', { name: 'Remove field_4', exact: true }).click()
  await expect(page.getByTestId('struct-payload')).toHaveText('3 B')
  await page.getByLabel('Readings per batch', { exact: true }).fill('10')
  await expect(page.getByTestId('struct-applicationUp')).toHaveText('56 B')
  await expect(page.getByTestId('struct-effective')).toHaveText('13.3 B')
  await page.locator('summary').filter({ hasText: 'Advanced settings' }).click()
  await page.getByLabel('IP version', { exact: true }).selectOption('IPv6')
  await expect(page.getByTestId('struct-effective')).toHaveText('17.3 B')
  await expect(page.getByTestId('coap-networkUp')).not.toHaveText('—')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByTestId('struct-networkUp')).toHaveText('56 B')
  expect(errors).toEqual([])
})
test('explanations, stream boundary, export, share, ROI and references', async ({ page }) => {
  await ready(page)
  await page.getByRole('button', { name: 'Struct: explain Total network uplink', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('56', { exact: false }).first()).toBeVisible()
  await expect(dialog.locator('a.lab-record-link')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await page.getByLabel('Measurement boundary', { exact: true }).selectOption('stream')
  await expect(page.getByTestId('protobuf-effective')).toHaveText('46 B')
  await expect(page.getByTestId('struct-effective')).toHaveText('—')
  await page.getByLabel('Comparison baseline', { exact: true }).selectOption('json')
  await settled(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON ↓', exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  let body = ''
  for await (const chunk of stream!) body += chunk
  const exported = JSON.parse(body)
  expect(exported.configuration.settings.boundary).toBe('stream')
  expect(exported.results.find((r: any) => r.id === 'protobuf').metrics.effective.value).toBe(46)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByLabel('Shareable configuration URL')).toBeVisible()
  const url = await page.getByLabel('Shareable configuration URL').inputValue()
  await page.goto(url)
  await page.reload()
  await expect(page.getByTestId('protobuf-effective')).toHaveText('46 B')
  const settings = page.getByRole('button', { name: 'Edit schema & settings' })
  if (await settings.isVisible()) await settings.click()
  await page.getByLabel('Measurement boundary', { exact: true }).selectOption('network')
  await page.locator('summary').filter({ hasText: 'Fleet & connectivity ROI' }).click()
  await page.getByLabel('Enable ROI', { exact: true }).check()
  await expect(page.getByRole('heading', { name: 'Connectivity cost & traffic' })).toBeVisible()
  await expect(page.locator('.lab-roi')).toContainText('Modeled metered cost')
  await page.locator('summary').filter({ hasText: 'Research Explorer' }).click()
  await expect(page.getByText('71,359 matching configurations', { exact: true })).toBeVisible()
  await page.getByLabel('Search benchmark records').fill('esp32-original')
  await expect(page.locator('.lab-research-record').first()).toContainText('esp32-original')
  await expect(page.getByText('NaN', { exact: true })).toHaveCount(0)
})
test('invalid input, secure mappings and responsive keyboard layout', async ({ page }) => {
  await ready(page)
  await page.getByLabel('temp sample value', { exact: true }).fill('NaN')
  await expect(page.getByRole('alert')).toContainText('finite')
  await page.getByLabel('temp sample value', { exact: true }).fill('23.5')
  await expect(page.getByTestId('struct-networkUp')).toHaveText('56 B')
  await page.getByLabel('Security', { exact: true }).uncheck()
  await expect(page.getByTestId('struct-applicationUp')).toHaveText('16 B')
  await expect(page.locator('.lab-table').first()).toContainText('V2-compatible plaintext LAB ONLY')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  const scroller = page.getByLabel('Protocol comparison, scroll horizontally')
  await scroller.focus()
  await expect(scroller).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.screenshot({ path: `../work/protocol-lab/${test.info().project.name}.png`, fullPage: true })
})
test('public API validation and original configuration regression', async ({ request }) => {
  const response = await request.post('/api/protocol-lab/calculate', { data: defaults() })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.results[0].metrics.networkUp.value).toBe(56)
  const invalid = defaults()
  invalid.fields[0]!.value = 'NaN'
  expect((await request.post('/api/protocol-lab/calculate', { data: invalid })).status()).toBe(422)
  expect(
    (
      await request.post('/api/protocol-lab/calculate', {
        data: 'x',
        headers: { 'content-type': 'text/plain' },
      })
    ).status(),
  ).toBe(415)
  const ref = await request.get('/api/protocol-lab/references?limit=1')
  expect((await ref.json()).total).toBe(71359)
})
test('dataset and API failures recover without showing invented values', async ({ page }) => {
  await page.route('**/api/protocol-lab/calculate', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Test dataset unavailable' }),
    }),
  )
  await page.goto('/benchmarks')
  await expect(page.getByRole('alert')).toContainText('Test dataset unavailable')
  await expect(page.getByTestId('struct-effective')).toHaveCount(0)
  await page.unroute('**/api/protocol-lab/calculate')
  await page.getByRole('button', { name: 'Retry calculation' }).click()
  await expect(page.getByTestId('struct-effective')).toHaveText('56 B')
  await page.getByRole('button',{name:'Advanced results',exact:true}).click()
  await expect(page.getByTestId('struct-networkUp')).toHaveText('56 B')
  await page.getByLabel('Scaling axis').selectOption('fields')
  await expect(page.getByLabel('Bytes per reading by Copies of the first schema field')).toBeVisible()
})

test('Simple results are default and changing views keeps schema without recalculating', async ({page})=>{
  let calculations=0
  page.on('request',r=>{if(r.url().endsWith('/api/protocol-lab/calculate'))calculations++})
  await page.goto('/benchmarks')
  await expect(page.getByTestId('struct-effective')).toHaveText('56 B')
  await expect(page.getByRole('button',{name:'Simple results',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(page.getByTestId('struct-payload')).toHaveCount(0)
  const before=calculations
  await page.getByRole('button',{name:'Advanced results',exact:true}).click()
  await expect(page.getByTestId('struct-payload')).toHaveText('3 B')
  await page.getByRole('button',{name:'Simple results',exact:true}).click()
  await expect(page.getByTestId('struct-effective')).toHaveText('56 B')
  expect(calculations).toBe(before)
})

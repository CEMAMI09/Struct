import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const runtimeErrors=new WeakMap<Page,string[]>()
test.beforeEach(({page})=>{const errors:string[]=[];runtimeErrors.set(page,errors);page.on('pageerror',e=>errors.push(e.message))})
test.afterEach(({page})=>{expect(runtimeErrors.get(page)).toEqual([])})

async function login(
  page: Page,
  path: string,
  email = 'local@example.invalid',
) {
  await page.goto('/login?redirect=' + encodeURIComponent(path))
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(path + '$'))
}
async function responsive(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true)
}
test('team invitation follows verified-recipient acceptance, survives auth navigation and records audit evidence', async ({
  page,
  browser,
}, info) => {
  await login(page, '/dashboard/organization')
  await expect(
    page.getByRole('region', { name: 'Workspace members' }),
  ).toContainText('developer')
  const email = `recipient-${info.project.name}@example.invalid`
  const fixture = await (
    await page.request.get('http://127.0.0.1:3125/__fixture')
  ).json()
  const overview = await (
    await page.request.get('/api/enterprise', {
      params: { orgId: fixture.org },
    })
  ).json()
  for (const i of overview.invitations.filter(
    (i: any) => i.email === email && !i.accepted_at && !i.revoked_at,
  )) {
    const revoked = await page.request.post('/api/enterprise/action', {
      data: { orgId: fixture.org, action: 'revoke_invite', data: { id: i.id } },
    })
    expect(revoked.status()).toBe(200)
  }
  const existing = overview.members.find((m: any) => m.email === email)
  if (existing) {
    const removed = await page.request.post('/api/enterprise/action', {
      data: {
        orgId: fixture.org,
        action: 'remove',
        data: { member: existing.id },
      },
    })
    expect(removed.status()).toBe(200)
  }
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page
    .getByRole('combobox', { name: 'Invitation role', exact: true })
    .selectOption('operator')
  await page
    .getByRole('button', { name: 'Create invitation', exact: true })
    .click()
  const secret = page.getByRole('region', {
    name: 'One-time sensitive information',
  })
  await expect(secret).toBeVisible()
  const link = await secret.locator('code').innerText()
  expect(link).toMatch(/^http:\/\/127.0.0.1:3120\/invite#token=/)
  await secret.getByRole('button', { name: 'Hide', exact: true }).click()
  await responsive(page)
  await page.screenshot({
    path: `../docs/phase-9/evidence/team-${info.project.name}.png`,
  })
  const recipientContext = await browser.newContext(),
    recipient = await recipientContext.newPage()
  await recipient.goto(link)
  await expect(recipient).toHaveURL(/\/invite$/)
  await recipient.getByRole('link', { name: 'Sign in', exact: true }).click()
  await recipient.getByLabel('Email', { exact: true }).fill(email)
  await recipient
    .getByLabel('Password', { exact: true })
    .fill('fixture-password')
  await recipient.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(recipient).toHaveURL(/\/invite$/)
  await recipient
    .getByRole('button', { name: 'Accept invitation', exact: true })
    .click()
  await expect(recipient).toHaveURL(/\/dashboard$/)
  await recipientContext.close()
  await page.goto('/dashboard/audit-logs')
  await page.getByLabel('Exact action', { exact: true }).fill('team.join')
  await page
    .getByRole('button', { name: 'Search audit history', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: 'Audit events' }),
  ).toContainText('team · join')
  const download = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Export up to 500 events', exact: true })
    .click()
  const file = await download,
    json = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(json.events.some((e: any) => e.event_action === 'team.join')).toBe(
    true,
  )
  expect(JSON.stringify(json)).not.toContain(link.split('token=')[1])
  await responsive(page)
})
test('one-time scoped management credential authenticates actual inventory and revocation blocks reuse', async ({
  page,
}, info) => {
  await login(page, '/dashboard/security')
  const name = 'Browser credential ' + info.project.name + ' ' + Date.now()
  await page.getByLabel('Credential name', { exact: true }).fill(name)
  await page
    .getByRole('button', { name: 'Create credential', exact: true })
    .click()
  const secret = page.getByRole('region', {
    name: 'One-time sensitive information',
  })
  await expect(secret).toBeVisible()
  const credential = await secret.locator('code').innerText()
  const response = await page.request.post('/api/enterprise/v1/request', {
    headers: { Authorization: 'Bearer ' + credential },
    data: { action: 'inventory' },
  })
  expect(response.status(), await response.text()).toBe(200)
  expect(JSON.stringify(await response.json())).toContain('Local sender')
  expect(response.headers()['cache-control']).toContain('no-store')
  await secret.getByRole('button', { name: 'Hide', exact: true }).click()
  const row = page
    .getByRole('region', { name: 'Management credentials' })
    .locator('article')
    .filter({ hasText: name })
  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: 'Revoke', exact: true }).click()
  await expect(row).toContainText('Revoked')
  const rejected = await page.request.post('/api/enterprise/v1/request', {
    headers: { Authorization: 'Bearer ' + credential },
    data: { action: 'inventory' },
  })
  expect(rejected.status()).toBe(401)
  await responsive(page)
  await page.screenshot({
    path: `../docs/phase-9/evidence/security-${info.project.name}.png`,
  })
  await page.goto('/dashboard/operations')
  await expect(
    page.getByRole('heading', { name: 'Operations', exact: true }).last(),
  ).toBeVisible()
  await expect(page.getByText('unknown', { exact: true }).first()).toBeVisible()
  await responsive(page)
  await page.screenshot({
    path: `../docs/phase-9/evidence/operations-${info.project.name}.png`,
  })
  const supportDownload = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download sanitized context', exact: true })
    .click()
  const support = JSON.parse(
    await readFile((await (await supportDownload).path())!, 'utf8'),
  )
  expect(support.role).toBe('owner')
  expect(JSON.stringify(support)).not.toContain(credential)
  await page.getByRole('link', { name: 'View guide', exact: true }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: /enterprise/i }),
  ).toBeVisible()
})

test('workspace creation rename last-owner protection and switching preserve tenant scope', async ({
  page,
}, info) => {
  await login(page, '/dashboard/organization')
  const fixture = await (
    await page.request.get('http://127.0.0.1:3125/__fixture')
  ).json()
  const name = 'Local workspace ' + info.project.name + ' ' + Date.now()
  await page.getByText('Create another workspace', { exact: true }).click()
  await page.getByLabel('New workspace name', { exact: true }).fill(name)
  await page
    .getByRole('button', { name: 'Create workspace', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { level: 2, name, exact: true }),
  ).toBeVisible()
  const selector = page.getByRole('combobox', {
    name: 'Organization',
    exact: true,
  })
  const createdOrg = await selector.inputValue()
  expect(createdOrg).not.toBe(fixture.org)
  await page
    .getByLabel('Organization name', { exact: true })
    .fill(name + ' renamed')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: name + ' renamed',
      exact: true,
    }),
  ).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Leave', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/last owner/i)
  await selector.selectOption(fixture.org)
  await expect(
    page.getByRole('heading', { level: 2, name: 'Pipeline test', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Workspace members' }),
  ).toContainText('developer')
  await page.goto('/dashboard/security')
  await selector.selectOption(createdOrg)
  await expect(
    page.getByRole('region', { name: 'Management credentials' }),
  ).toContainText('No credentials.')
  await responsive(page)
})
test('developer operator and viewer have readable team context and cannot invoke administrative APIs', async ({
  page,
}, info) => {
  const fixture = await (
    await page.request.get('http://127.0.0.1:3125/__fixture')
  ).json()
  for (const role of ['developer', 'operator', 'viewer']) {
    await login(page, '/dashboard/organization', role + '@example.invalid')
    await expect(
      page.getByRole('region', { name: 'Workspace members' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Create invitation', exact: true }),
    ).toHaveCount(0)
    const denied = await page.request.post('/api/enterprise/action', {
      data: {
        orgId: fixture.org,
        action: 'rename',
        data: { name: 'Forbidden' },
      },
    })
    expect(denied.status()).toBe(403)
    const other = await page.request.get('/api/enterprise', {
      params: { orgId: fixture.otherOrg },
    })
    expect(other.status()).toBe(403)
    await page.goto('/dashboard/security')
    await expect(
      page.getByRole('button', { name: 'Create credential', exact: true }),
    ).toHaveCount(0)
    await responsive(page)
    // Use the existing logout endpoint/session API; never share contexts between roles.
    await page.context().clearCookies()
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  }
})

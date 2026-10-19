import { test, expect, type Page } from '@playwright/test'
const org = '10000000-0000-0000-0000-000000000002',
  id = '20000000-0000-0000-0000-000000000001'
async function setup(page: Page, viewer = false) {
  const state = {
    items: [] as any[],
    actions: [] as any[],
    saved: null as any,
    fail: false,
  }
  await page.route('**/api/**', (r) => r.fulfill({ json: { deviceLimit: 5 } }))
  await page.route('**/rest/v1/organization_members*', (r) =>
    r.fulfill({
      json: [
        {
          user_id: '10000000-0000-0000-0000-000000000001',
          organization_id: org,
          role: viewer ? 'viewer' : 'owner',
          organization: {
            id: org,
            name: 'Local workspace',
            subscription_tier: 'scale',
            stripe_quantity: 0,
          },
        },
      ],
    }),
  )
  await page.route('**/api/integrations?*', (r) =>
    r.fulfill({
      json: {
        integrations: state.items,
        health: {
          destinations: state.items.map((i) => ({
            id: i.destination_id,
            backlog: 3,
            last_success: null,
            failures_24h: 2,
          })),
        },
      },
    }),
  )
  await page.route('**/api/integrations', async (r) => {
    const body = r.request().postDataJSON()
    if (state.fail)
      return r.fulfill({
        status: 400,
        json: { message: 'Invalid routing threshold' },
      })
    state.saved = body
    state.items = [
      {
        destination_id: id,
        organization_id: org,
        kind: body.kind,
        version: (body.version || 0) + 1,
        config: body.config,
        route: body.route,
        mapping: body.mapping,
        destination: {
          name: body.name,
          enabled: !!body.id && body.enabled,
          paused_at: null,
        },
        last_check: null,
        updated_at: new Date().toISOString(),
      },
    ]
    return r.fulfill({ json: { id, version: state.items[0].version } })
  })
  await page.route('**/api/integrations/action', async (r) => {
    const body = r.request().postDataJSON()
    state.actions.push(body)
    const item = state.items[0]
    if (body.action === 'enable') item.destination.enabled = true
    if (body.action === 'pause')
      item.destination.paused_at = new Date().toISOString()
    if (body.action === 'resume') item.destination.paused_at = null
    if (body.action === 'delete') state.items = []
    return r.fulfill({
      json:
        body.action === 'preview_remap'
          ? { eligible: 2 }
          : body.action === 'remap'
            ? { scheduled: 2 }
            : body.action === 'check'
              ? {
                  level: 'configuration_valid',
                  detail: 'Configuration valid; no event sent',
                }
              : body.action === 'preview'
                ? {
                    matched: true,
                    transformed: {
                      format_version: 'struct.event.v1',
                      event_id: id,
                      data: body.sample,
                    },
                  }
                : {
                    accepted: true,
                    detail:
                      body.action === 'test_send'
                        ? 'Synthetic event accepted by destination'
                        : undefined,
                  },
    })
  })
  return state
}
async function login(page: Page) {
  await page.goto('/login?redirect=%2Fdashboard%2Fintegrations')
  await page.getByLabel('Email', { exact: true }).fill('local@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard\/integrations$/)
  await expect(
    page.getByRole('heading', { name: 'Integrations', exact: true }).last(),
  ).toBeVisible()
}
async function fillHttp(page: Page) {
  await page.getByRole('button', { name: /HTTP \/ Webhook/ }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page
    .getByLabel('Connection name', { exact: true })
    .fill('Production API')
  await page
    .getByLabel('HTTPS endpoint', { exact: true })
    .fill('https://app.example.com/telemetry')
  await page
    .getByLabel('HMAC signing secret', { exact: true })
    .fill('local-test-secret')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
}
async function saveHttp(page: Page) {
  await fillHttp(page)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page
    .getByRole('button', { name: 'Save configuration', exact: true })
    .click()
  await expect(page.getByText(/Step 6 of 7/)).toBeVisible()
}
test('guided setup saves disabled, verifies without send, then explicitly enables', async ({
  page,
}, info) => {
  const state = await setup(page)
  await login(page)
  await saveHttp(page)
  expect(state.items[0].destination.enabled).toBe(false)
  expect(state.actions).toHaveLength(0)
  expect(state.saved.credentials.signingSecret).toBe('local-test-secret')
  await page
    .getByRole('button', { name: 'Verify connection', exact: true })
    .first()
    .click()
  await expect(page.getByRole('status')).toContainText(
    'Configuration valid; no event sent',
  )
  expect(state.actions[0].action).toBe('check')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const enable = page.getByRole('button', {
    name: 'Enable integration',
    exact: true,
  })
  await expect(enable).toBeDisabled()
  await page.getByLabel('I reviewed this destination', { exact: false }).check()
  await enable.click()
  await expect(page.getByText(/Version 1 · Enabled/)).toBeVisible()
  expect(state.actions.some((a) => a.action === 'test_send')).toBe(false)
  await page
    .getByRole('button', { name: 'View connection', exact: true })
    .click()
  await expect(page.getByText(/3 pending/)).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: `../docs/phase-7/evidence/${info.project.name}-integrations.png`,
    fullPage: true,
  })
})
test('routing and field mapping preserve configured values in save', async ({
  page,
}) => {
  const state = await setup(page)
  await login(page)
  await fillHttp(page)
  await page
    .getByRole('combobox', { name: 'Match', exact: true })
    .selectOption('all')
  await page.getByRole('button', { name: 'Add condition', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Field or metadata', exact: true })
    .fill('payload.temperature')
  await page.getByRole('textbox', { name: /Value \(JSON scalar/ }).fill('40')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page
    .getByRole('button', { name: 'Select / rename field', exact: true })
    .click()
  await page
    .getByLabel('Source field path', { exact: true })
    .fill('temperature')
  await page
    .getByLabel('Destination field', { exact: true })
    .fill('temperature_celsius')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page
    .getByRole('button', { name: 'Save configuration', exact: true })
    .click()
  await expect(page.getByText(/Step 6 of 7/)).toBeVisible()
  expect(state.saved.route.all[0]).toEqual({
    field: 'payload.temperature',
    op: 'gt',
    value: 40,
  })
  expect(state.saved.mapping.fields[0].to).toBe('temperature_celsius')
})
test('pause, resume, sample preview, test-send and delete have distinct behavior', async ({
  page,
}) => {
  const state = await setup(page)
  await login(page)
  await saveHttp(page)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page
    .getByRole('button', { name: 'Finish without enabling', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'View connection', exact: true })
    .click()
  await page.getByRole('button', { name: 'Enable', exact: true }).click()
  await page
    .getByRole('button', { name: 'Confirm enable', exact: true })
    .click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.getByText(/Version 1 · Paused/)).toBeVisible()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.getByText('Preview routing and mapping', { exact: true }).click()
  await page
    .getByRole('button', { name: 'Preview without sending', exact: true })
    .click()
  await expect(page.getByText(/"matched": true/)).toBeVisible()
  await page
    .getByRole('button', { name: 'Send explicit test event', exact: true })
    .click()
  expect(state.actions.filter((a) => a.action === 'test_send')).toHaveLength(0)
  await page
    .getByRole('button', { name: 'Confirm test send', exact: true })
    .click()
  expect(state.actions.find((a) => a.action === 'test_send').confirm).toBe(true)
  await page
    .getByRole('button', { name: 'Delete connection', exact: true })
    .click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(state.items).toHaveLength(1)
  await page
    .getByRole('button', { name: 'Delete connection', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Confirm delete', exact: true })
    .click()
  await expect(
    page.getByText(
      'Choose a destination above to create your first connection.',
    ),
  ).toBeVisible()
})
test('server validation errors preserve configuration and do not enable', async ({
  page,
}) => {
  const state = await setup(page)
  state.fail = true
  await login(page)
  await fillHttp(page)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page
    .getByRole('button', { name: 'Save configuration', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Invalid routing threshold',
  )
  expect(state.actions).toHaveLength(0)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: 'Event format', exact: true }),
  ).toBeVisible()
})
test('viewers cannot create connections; provider docs resolve and keyboard navigation works', async ({
  page,
}) => {
  await setup(page, true)
  await login(page)
  await expect(page.getByRole('button', { name: /AWS SQS/ })).toBeDisabled()
  await page.getByRole('link', { name: 'Setup guide', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/docs\/integrations$/)
  await expect(
    page.getByRole('heading', { name: 'Bring your own backend', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: 'PostgreSQL integration', exact: true })
    .click()
  await expect(
    page.getByText(/CREATE TABLE public.struct_events/),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('mapping recovery previews scope and requires confirmation before requeue', async ({
  page,
}) => {
  const state = await setup(page)
  await login(page)
  await saveHttp(page)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page
    .getByRole('button', { name: 'Finish without enabling', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'View connection', exact: true })
    .click()
  await page.getByRole('button', { name: 'Enable', exact: true }).click()
  await page
    .getByRole('button', { name: 'Confirm enable', exact: true })
    .click()
  await page
    .getByRole('button', {
      name: 'Retry failures with current mapping',
      exact: true,
    })
    .click()
  await expect(page.getByRole('dialog')).toContainText(
    'Retry 2 eligible failed deliveries',
  )
  expect(state.actions.filter((a) => a.action === 'remap')).toHaveLength(0)
  await page.getByRole('button', { name: 'Confirm remap', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('2 deliveries queued')
  const preview = state.actions.find((a) => a.action === 'preview_remap'),
    actual = state.actions.find((a) => a.action === 'remap')
  expect(actual.requestId).toBe(preview.requestId)
  expect(actual.confirm).toBe(true)
})

import { test, expect, type Page } from '@playwright/test'
const org = '10000000-0000-0000-0000-000000000002',
  device = '10000000-0000-0000-0000-000000000003',
  destination = '20000000-0000-0000-0000-000000000001',
  event = '30000000-0000-0000-0000-000000000001',
  delivery = '40000000-0000-0000-0000-000000000001'
const when = '2026-10-11T12:00:00Z'
async function setup(page: Page) {
  const state = {
    status: 'dead',
    recovery: 0,
    requestIds: [] as string[],
    searches: [] as Record<string, unknown>[],
    paused: false,
    invalid: false,
    viewer: false,
    pages: false,
  }
  await page.route('**/api/**', (r) => r.fulfill({ json: { deviceLimit: 5 } }))
  await page.route('**/rest/v1/**', async (r) => {
    const path = new URL(r.request().url()).pathname,
      body = r.request().method() === 'POST' ? r.request().postDataJSON() : {}
    let json: unknown = []
    if (path.endsWith('/organization_members'))
      json = [
        {
          id: device,
          user_id: '10000000-0000-0000-0000-000000000001',
          organization_id: org,
          role: state.viewer ? 'viewer' : 'owner',
          organization: {
            id: org,
            name: 'Local workspace',
            subscription_tier: 'scale',
            stripe_quantity: 0,
          },
        },
      ]
    else if (path.endsWith('/devices'))
      json = [
        {
          id: device,
          organization_id: org,
          name: 'Local sensor',
          created_at: when,
          last_seen: when,
          secure_v2_enabled: true,
        },
      ]
    else if (path.endsWith('/rpc/delivery_overview'))
      json = {
        counts: {
          pending: state.status === 'pending' ? 1 : 0,
          dead: state.status === 'dead' ? 1 : 0,
          delivered: 0,
          sending: 0,
        },
        oldest_pending: null,
        destinations: [
          {
            id: destination,
            name: 'Production API',
            enabled: true,
            paused_at: state.paused ? when : null,
            backlog: 1,
            last_success: null,
            dead: 1,
            failures_24h: 2,
            attempts_24h: 3,
          },
        ],
      }
    else if (path.endsWith('/rpc/delivery_search')) {
      state.searches.push(body)
      json = state.invalid
        ? null
        : Array.from(
            { length: state.pages && !body.p_before ? 51 : 1 },
            (_, i) => ({
              id: i
                ? `40000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
                : delivery,
              event_id: event,
              device_id: device,
              device_name: 'Local sensor',
              destination_id: destination,
              status: state.status,
              attempts: 2,
              total_attempts: 2,
              replay_count: 0,
              created_at: when,
              updated_at: when,
              last_attempt_at: when,
              next_attempt_at: when,
              delivered_at: null,
              last_error: 'HTTP 503',
              error_category: 'http_transient',
              http_status: 503,
              terminal_reason: null,
              payload_expires_at: '2099-01-01T00:00:00Z',
              payload_available: true,
              protocol: 'secure-v2',
              schema_slot: 0,
              sequence: 42,
              record_index: 0,
              accepted_at: when,
            }),
          )
    } else if (path.endsWith('/rpc/delivery_recovery_selection')) {
      json = { ids: [delivery], eligible_total: 42 }
    } else if (path.endsWith('/rpc/delivery_recovery')) {
      if (body.p_action.startsWith('preview_'))
        json = { selected: body.p_ids.length, eligible: body.p_ids.length }
      else {
        state.recovery++
        state.requestIds.push(body.p_request_id)
        state.status = 'pending'
        json = { scheduled: body.p_ids.length, duplicate_request: false }
      }
    } else if (path.endsWith('/rpc/pause_webhook_destination')) {
      state.paused = body.p_pause
      json = null
    } else if (path.endsWith('/rpc/delivery_event_detail'))
      json = {
        event: {
          id: event,
          device_id: device,
          device_name: 'Local sensor',
          accepted_at: when,
          sample_at: when,
          protocol: 'secure-v2',
          wire_device_id: 42,
          sequence: 42,
          record_index: 0,
          schema_slot: 0,
        },
        deliveries: [
          {
            id: delivery,
            event_id: event,
            created_at: when,
            status: state.status,
          },
        ],
        attempts: [
          {
            id: 1,
            delivery_id: delivery,
            attempt_number: 1,
            attempted_at: when,
            completed_at: '2026-10-11T12:00:08Z',
            outcome: 'retry',
            detail: 'HTTP 503',
            http_status: 503,
            error_category: 'http_transient',
            latency_ms: 8000,
            next_retry_at: '2026-10-11T12:00:18Z',
          },
        ],
        actions: [],
        traces: [],
      }
    await r.fulfill({ json })
  })
  return state
}
async function login(page: Page) {
  await page.goto('/login?redirect=%2Fdashboard%2Fdeliveries')
  await expect(page.getByLabel('Email', { exact: true })).toBeEnabled()
  await page.getByLabel('Email', { exact: true }).fill('local@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard\/deliveries$/)
  await expect(
    page.getByRole('button', { name: 'Search deliveries', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Trace', exact: true }).first(),
  ).toBeVisible()
}
test('trace uses recorded evidence and remains responsive', async ({
  page,
}, info) => {
  await setup(page)
  await login(page)
  await page.screenshot({
    path: '../docs/phase-3-4/evidence/' + info.project.name + '-overview.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Trace', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Event trace', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Device telemetry', exact: true })).toHaveAttribute('href', `/dashboard?device=${device}`)
  await expect(page.getByText('Retry scheduled', { exact: true })).toBeVisible()
  await expect(
    page.getByText(/Stored telemetry and webhook delivery are separate/),
  ).toBeVisible()
  await page
    .getByText('Gateway evidence and response details', { exact: true })
    .click()
  await expect(
    page.getByText(
      'No authenticated gateway capture available for this event.',
    ),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: '../docs/phase-3-4/evidence/' + info.project.name + '-delivery.png',
    fullPage: true,
  })
})
test('retry preview requires confirmation and only reports scheduling', async ({
  page,
}) => {
  const state = await setup(page)
  await login(page)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Confirm action', exact: true }),
  ).toBeDisabled()
  expect(state.recovery).toBe(0)
  await page
    .getByLabel('I understand this can repeat downstream processing.')
    .check()
  await page
    .getByRole('button', { name: 'Confirm action', exact: true })
    .click()
  await expect(
    page.getByText('Recovery queued. Delivery has not yet been confirmed.'),
  ).toBeVisible()
  expect(state.recovery).toBe(1)
  expect(state.requestIds[0]).toMatch(/^[0-9a-f-]{36}$/)
  await expect(page.getByText('Retrying', { exact: true })).toBeVisible()
})
test('filters and keyset pagination query the server', async ({ page }) => {
  const state = await setup(page)
  state.pages = true
  await login(page)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect.poll(() => state.searches.at(-1)?.p_before).toBe(when)
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Delivery status', exact: true })
    .selectOption('dead')
  await page.getByLabel('Event identifier', { exact: true }).fill(event)
  await page
    .getByRole('button', { name: 'Search deliveries', exact: true })
    .click()
  await expect.poll(() => state.searches.at(-1)?.p_status).toBe('dead')
  expect(state.searches.at(-1)?.p_event_id).toBe(event)
  expect(state.searches.at(-1)?.p_before).toBeNull()
})
test('filtered bulk recovery previews a bounded selection before scheduling', async ({
  page,
}) => {
  const state = await setup(page)
  await login(page)
  await page
    .getByRole('button', { name: 'Retry eligible matches', exact: true })
    .click()
  await expect(page.getByText(/Previewing the oldest 1 of 42/)).toBeVisible()
  expect(state.recovery).toBe(0)
  await page
    .getByLabel('I understand this can repeat downstream processing.')
    .check()
  await page
    .getByRole('button', { name: 'Confirm action', exact: true })
    .click()
  await expect(
    page.getByText('Recovery queued. Delivery has not yet been confirmed.'),
  ).toBeVisible()
  expect(state.recovery).toBe(1)
})
test('destination pause retains work and viewer recovery is absent', async ({
  page,
}) => {
  const state = await setup(page)
  await login(page)
  await page.getByText(/Destination health ·/).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible()
  expect(state.paused).toBe(true)
  state.viewer = true
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Trace', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toHaveCount(0)
})
test('invalid input and missing backend data produce explicit errors', async ({
  page,
}) => {
  const state = await setup(page)
  await login(page)
  await page.getByLabel('Event identifier', { exact: true }).fill('invalid')
  await page
    .getByRole('button', { name: 'Search deliveries', exact: true })
    .click()
  await expect(page.getByText('Enter a valid event UUID.')).toBeVisible()
  state.invalid = true
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(
    page.getByText(/Unable to complete the delivery operation/),
  ).toBeVisible()
  await page.goto('/docs/delivery')
  await expect(
    page.getByRole('heading', {
      name: 'Delivery lifecycle and recovery',
      exact: true,
    }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

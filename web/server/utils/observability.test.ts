import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
const org = '10000000-0000-0000-0000-000000000002',
  user = '10000000-0000-0000-0000-000000000001'
let role: string | null = 'owner',
  authenticated = true,
  enabled = true,
  calls: any[] = [],
  context: any,
  body: any,
  filter: any,
  action: any,
  usage: any
const old = process.env.STRUCT_OBSERVABILITY_ENABLED
const event = (data: any = {}, query: any = {}, headers: any = {}) => ({
  node: { req: Readable.from([JSON.stringify(data)]) },
  query,
  headers: { 'content-type': 'application/json', ...headers },
})
beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (h: any) => h)
  vi.stubGlobal('getQuery', (e: any) => e.query)
  vi.stubGlobal('getHeader', (e: any, k: string) => e.headers[k])
  vi.stubGlobal('setHeader', () => {})
  vi.stubGlobal('createError', (e: any) =>
    Object.assign(new Error(e.message), { statusCode: e.statusCode }),
  )
  vi.mocked(serverSupabaseClient).mockImplementation(async () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: role ? { role } : null }),
    }
    return {
      auth: {
        getUser: async () => ({
          data: { user: authenticated ? { id: user } : null },
        }),
      },
      from: () => q,
    } as never
  })
  vi.mocked(serverSupabaseServiceRole).mockImplementation(() => {
    const q: any = {
      select: () => q,
      eq: () => q,
      single: async () => ({ data: { enabled } }),
    }
    return {
      from: () => q,
      rpc: async (name: string, args: any) => {
        calls.push({ name, args })
        return { data: { ok: true }, error: null }
      },
    } as never
  })
  const m = await import('./observability')
  context = m.observabilityContext
  body = m.observabilityBody
  filter = m.monitoringFilter
  action = (await import('../api/observability/action.post')).default
  usage = (await import('../api/observability/usage.get')).default
})
beforeEach(() => {
  process.env.STRUCT_OBSERVABILITY_ENABLED = 'true'
  role = 'owner'
  authenticated = true
  enabled = true
  calls = []
})
afterAll(() => {
  if (old === undefined) delete process.env.STRUCT_OBSERVABILITY_ENABLED
  else process.env.STRUCT_OBSERVABILITY_ENABLED = old
  vi.unstubAllGlobals()
})
it('requires server and database activation', async () => {
  process.env.STRUCT_OBSERVABILITY_ENABLED = 'false'
  await expect(context(event(), org)).rejects.toMatchObject({ statusCode: 503 })
  process.env.STRUCT_OBSERVABILITY_ENABLED = 'true'
  enabled = false
  await expect(context(event(), org)).rejects.toMatchObject({ statusCode: 503 })
})
it('rejects unauthenticated and unrelated workspace access', async () => {
  authenticated = false
  await expect(context(event(), org)).rejects.toMatchObject({ statusCode: 401 })
  authenticated = true
  role = null
  await expect(context(event(), org)).rejects.toMatchObject({ statusCode: 403 })
})
it('permits viewer reads and personal preferences, not rule writes', async () => {
  role = 'viewer'
  await context(event(), org)
  await expect(
    action(
      event({
        orgId: org,
        action: 'rule',
        data: { kind: 'bytes', threshold: 1, clear: 0 },
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 403 })
  await action(
    event({
      orgId: org,
      action: 'email_preferences',
      data: { enabled: false },
    }),
  )
  expect(calls[0].args.p_actor).toBe(user)
})
it('bounds JSON and rejects cross-site mutations', async () => {
  await expect(
    body(event({}, {}, { 'sec-fetch-site': 'cross-site' })),
  ).rejects.toMatchObject({ statusCode: 400 })
  await expect(body(event({ value: 'a'.repeat(17000) }))).rejects.toMatchObject(
    { statusCode: 413 },
  )
})
it('rejects unsupported expressions and missing sensor scope', async () => {
  await expect(
    action(
      event({
        orgId: org,
        action: 'rule',
        data: { kind: 'javascript', threshold: 1, clear: 0 },
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 400 })
  await expect(
    action(
      event({
        orgId: org,
        action: 'rule',
        data: { kind: 'sensor', field: 'temperature', threshold: 1, clear: 0 },
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 400 })
  expect(calls).toHaveLength(0)
})
it('uses authenticated actor and bounded filter allowlist', async () => {
  await action(
    event({
      orgId: org,
      action: 'rule',
      data: { kind: 'bytes', threshold: 1, clear: 0 },
    }),
  )
  expect(calls[0]).toMatchObject({
    name: 'observability_command',
    args: { p_actor: user, p_org: org },
  })
  expect(
    filter({ group: org, slot: 2, incidentPage: 1, sql: 'delete' }),
  ).toEqual({ group: org, slot: 2, incidentPage: 1 })
  expect(() => filter({ incidentPage: 3000 })).toThrow()
})
it('bounds time windows before database work', async () => {
  await expect(
    usage(event({}, { orgId: org, from: 'bad', to: 'bad' })),
  ).rejects.toMatchObject({ statusCode: 400 })
  expect(calls).toHaveLength(0)
})
it('normalizes valid time windows and protects cache', async () => {
  await usage(
    event(
      {},
      { orgId: org, from: '2026-10-12T00:00:00Z', to: '2026-10-13T00:00:00Z' },
    ),
  )
  expect(calls[0].name).toBe('usage_analytics')
  expect(calls[0].args.p_actor).toBe(user)
})

it('bounds repeated authorized reads per process', async () => {
  const rateOrg = '10000000-0000-0000-0000-000000000099'
  for (let i = 0; i < 240; i++) await context(event(), rateOrg)
  await expect(context(event(), rateOrg)).rejects.toMatchObject({
    statusCode: 429,
  })
})

import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
const org = '10000000-0000-0000-0000-000000000002',
  user = '10000000-0000-0000-0000-000000000001'
let role: string | null = 'owner',
  authenticated = true,
  lastArgs: any,
  calls = 0,
  save: any,
  list: any,
  action: any,
  row: any
const oldKey = process.env.STRUCT_INTEGRATION_KEY,
  oldEnabled = process.env.STRUCT_INTEGRATIONS_ENABLED
const event = (
  body: unknown = {},
  query: unknown = {},
  headers: Record<string, string> = {},
) => ({
  node: { req: Readable.from([JSON.stringify(body)]) },
  query,
  headers: { 'content-type': 'application/json', ...headers } as Record<string,string>,
})
beforeAll(async () => {
  process.env.STRUCT_INTEGRATION_KEY = '56'.repeat(32)
  process.env.STRUCT_INTEGRATIONS_ENABLED = 'true'
  vi.stubGlobal('defineEventHandler', (h: unknown) => h)
  vi.stubGlobal('getQuery', (e: any) => e.query)
  vi.stubGlobal('setHeader', (e: any, k: string, v: string) => {
    e.headers[k] = v
  })
  vi.stubGlobal('getHeader', (e: any, k: string) => e.headers[k])
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
          error: null,
        }),
      },
      from: () => q,
      rpc: async () => ({ data: { counts: {} } }),
    } as never
  })
  vi.mocked(serverSupabaseServiceRole).mockImplementation(() => {
    const q: any = {
      select: (columns: string) => {
        lastArgs = { columns }
        return q
      },
      eq: () => q,
      is: () => q,
      order: () => q,
      limit: async () => ({ data: [] }),
      maybeSingle: async () => ({ data: row }),
    }
    return {
      from: () => q,
      rpc: async (name: string, args: any) => {
        calls++
        lastArgs = { name, args }
        return { data: 1, error: null }
      },
    } as never
  })
  save = (await import('../api/integrations/index.post')).default
  list = (await import('../api/integrations/index.get')).default
  action = (await import('../api/integrations/action.post')).default
})
beforeEach(() => {
  role = 'owner'
  authenticated = true
  calls = 0
  row = null
  process.env.STRUCT_INTEGRATIONS_ENABLED = 'true'
})
afterAll(() => {
  if (oldKey === undefined) delete process.env.STRUCT_INTEGRATION_KEY
  else process.env.STRUCT_INTEGRATION_KEY = oldKey
  if (oldEnabled === undefined) delete process.env.STRUCT_INTEGRATIONS_ENABLED
  else process.env.STRUCT_INTEGRATIONS_ENABLED = oldEnabled
  vi.unstubAllGlobals()
})
const valid = () => ({
  orgId: org,
  name: 'Webhook',
  kind: 'http',
  config: { url: 'https://app.example.com/hook' },
  credentials: { signingSecret: 'private-test-secret' },
})
it('requires activation and authenticated authorized workspace access', async () => {
  process.env.STRUCT_INTEGRATIONS_ENABLED = 'false'
  await expect(save(event(valid()))).rejects.toMatchObject({ statusCode: 503 })
  process.env.STRUCT_INTEGRATIONS_ENABLED = 'true'
  authenticated = false
  await expect(list(event({}, { orgId: org }))).rejects.toMatchObject({
    statusCode: 401,
  })
  authenticated = true
  role = null
  await expect(list(event({}, { orgId: org }))).rejects.toMatchObject({
    statusCode: 403,
  })
  role = 'viewer'
  await expect(save(event(valid()))).rejects.toMatchObject({ statusCode: 403 })
  expect(calls).toBe(0)
})
it('encrypts credentials, returns only identity/version and marks reads no-store', async () => {
  const result = await save(event(valid()))
  expect(result).toHaveProperty('id')
  expect(JSON.stringify(result)).not.toContain('private-test-secret')
  expect(lastArgs.args.p_credentials).toMatch(/^v1:/)
  expect(lastArgs.args.p_credentials).not.toContain('private-test-secret')
  expect(lastArgs.args.p_expected_version).toBe(0)
  const request = event({}, { orgId: org })
  await list(request)
  expect(request.headers['cache-control']).toBe('no-store')
  expect(lastArgs.columns).not.toContain('credentials_encrypted')
})
it('rejects cross-site requests, invalid JSON, oversized input, unsafe hosts and identifiers before saving', async () => {
  await expect(
    save(event(valid(), {}, { 'sec-fetch-site': 'cross-site' })),
  ).rejects.toMatchObject({ statusCode: 400 })
  await expect(
    save(event({ padding: 'x'.repeat(65537) })),
  ).rejects.toMatchObject({ statusCode: 413 })
  await expect(
    save(event({ ...valid(), config: { url: 'https://localhost' } })),
  ).rejects.toMatchObject({ statusCode: 400 })
  await expect(
    save(
      event({
        ...valid(),
        kind: 'postgresql',
        config: {
          host: 'db.example.com',
          database: 'db',
          table: 'x;drop table x',
        },
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 400 })
  expect(calls).toBe(0)
})
it('rejects stale configuration and unconfirmed destructive/test actions', async () => {
  row = { kind: 'http', version: 2 }
  const input = {
    orgId: org,
    id: '20000000-0000-0000-0000-000000000001',
    version: 1,
    action: 'test_send',
  }
  await expect(action(event(input))).rejects.toMatchObject({ statusCode: 409 })
  await expect(action(event({ ...input, version: 2 }))).rejects.toMatchObject({
    statusCode: 400,
  })
  expect(calls).toBe(0)
})

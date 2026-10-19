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
  calls: any[] = [],
  preview: any,
  context: any,
  filter: any,
  body: any
const enabled = process.env.STRUCT_FLEET_ENABLED
const event = (value: any = {}, headers: any = {}) => ({
  node: { req: Readable.from([JSON.stringify(value)]) },
  headers: { 'content-type': 'application/json', ...headers },
})
vi.mock('./deviceCapacity', () => ({
  resolveCapacityPlan: vi.fn(async () => ({
    currentCount: 1,
    projectedCount: 2,
    estimatedTrueUpCents: 0,
    currency: 'usd',
  })),
}))
beforeAll(async () => {
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
      limit: async () => ({ data: [] }),
      single: async () => ({ data: { enabled: true } }),
    }
    return {
      from: () => q,
      rpc: async (name: string, args: any) => {
        calls.push({ name, args })
        return {
          data:
            name === 'fleet_creation_estimate' ? { createsUpperBound: 1 } : org,
          error: null,
        }
      },
    } as never
  })
  const mod = await import('./fleet')
  preview = mod.previewFleet
  context = mod.fleetContext
  filter = mod.fleetFilter
  body = mod.fleetBody
})
beforeEach(() => {
  role = 'owner'
  authenticated = true
  calls = []
  process.env.STRUCT_FLEET_ENABLED = 'true'
})
afterAll(() => {
  if (enabled === undefined) delete process.env.STRUCT_FLEET_ENABLED
  else process.env.STRUCT_FLEET_ENABLED = enabled
  vi.unstubAllGlobals()
})
it('requires explicit activation and tenant access', async () => {
  process.env.STRUCT_FLEET_ENABLED = 'false'
  await expect(context(event(), org)).rejects.toMatchObject({ statusCode: 503 })
  process.env.STRUCT_FLEET_ENABLED = 'true'
  authenticated = false
  await expect(context(event(), org)).rejects.toMatchObject({ statusCode: 401 })
  authenticated = true
  role = null
  await expect(context(event(), org)).rejects.toMatchObject({ statusCode: 403 })
})
it('rejects viewers creating jobs', async () => {
  role = 'viewer'
  await expect(preview(event({ orgId: org }))).rejects.toMatchObject({
    statusCode: 403,
  })
  expect(calls).toHaveLength(0)
})
it('creates preview with normalized safe fields and no secrets', async () => {
  await preview(
    event({
      orgId: org,
      requestId: org,
      operation: 'create',
      rows: [{ name: ' Unit ', external_id: 'X' }],
      options: { labels: ['Outdoor'] },
    }),
  )
  const call = calls.at(-1)
  expect(call.name).toBe('fleet_preview')
  expect(call.args.p_rows[0].name).toBe('Unit')
  expect(call.args.p_options.labels).toEqual(['outdoor'])
  expect(call.args.p_actor).toBe(user)
})
it('rejects secret import and invalid configuration without scheduling', async () => {
  await expect(
    preview(
      event({
        orgId: org,
        requestId: org,
        operation: 'create',
        rows: [{ name: 'Unit', rootSecret: 'secret' }],
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 400 })
  expect(calls).toHaveLength(0)
})
it('requires versions for explicit mutations', async () => {
  await expect(
    preview(
      event({
        orgId: org,
        requestId: org,
        operation: 'disable',
        rows: [{ id: org }],
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 400 })
})
it('snapshots filters server-side without enumerating a browser fleet', async () => {
  await preview(
    event({
      orgId: org,
      requestId: org,
      operation: 'disable',
      filter: { group: org, labels: ['outdoor'] },
    }),
  )
  expect(calls.at(-1).args.p_filter).toEqual({
    group: org,
    labels: ['outdoor'],
  })
  expect(calls.at(-1).args.p_rows).toEqual([])
})
it('validates mapped CSV rows on server', async () => {
  await expect(
    preview(
      event({
        orgId: org,
        requestId: org,
        operation: 'create',
        csv: 'title\n',
        mapping: { title: 'name' },
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 400 })
})
it('rejects cross-site, oversized and malformed bodies', async () => {
  await expect(
    body(event({}, { 'sec-fetch-site': 'cross-site' })),
  ).rejects.toMatchObject({ statusCode: 400 })
  await expect(
    body(event({ x: 'a'.repeat(8 * 1024 * 1024) })),
  ).rejects.toMatchObject({ statusCode: 413 })
  await expect(
    body({
      node: { req: Readable.from(['{']) },
      headers: { 'content-type': 'application/json' },
    }),
  ).rejects.toMatchObject({ statusCode: 400 })
})
it('bounds and validates all inventory filters', () => {
  expect(() => filter({ search: 'x'.repeat(129) })).toThrow()
  expect(() => filter({ group: 'not-uuid' })).toThrow()
  expect(() => filter({ status: 'connected' })).toThrow()
  expect(filter({ labels: ['Outdoor'], sort: 'seen' })).toEqual({
    labels: ['outdoor'],
    sort: 'seen',
  })
})

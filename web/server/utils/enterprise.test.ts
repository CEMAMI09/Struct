import { it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { Readable } from 'node:stream'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
import { requireOrgWriter } from './auth'
import {
  enterpriseBody,
  newManagementSecret,
  parseManagementSecret,
  enterpriseRate,
  applicationOrigin,
  enterpriseError,
} from './enterprise'
const org = '10000000-0000-0000-0000-000000000002',
  actor = '10000000-0000-0000-0000-000000000001'
let role: string | null = 'owner',
  authCalls = 0,
  membershipCalls = 0,
  deniedCalls = 0,
  unavailable = false
const event = (body: any = {}, headers: any = {}) =>
  ({
    context: {},
    headers: { 'content-type': 'application/json', ...headers },
    node: {
      req: Readable.from([
        typeof body === 'string' ? body : JSON.stringify(body),
      ]),
    },
  }) as any
beforeAll(() => {
  vi.stubGlobal('defineEventHandler', (f: any) => f)
  vi.stubGlobal('createError', (e: any) =>
    Object.assign(new Error(e.message), e),
  )
  vi.stubGlobal('setHeader', () => {})
  vi.stubGlobal('getHeader', (e: any, k: string) => e.headers[k])
  vi.stubGlobal(
    'getRequestURL',
    () => new URL('http://localhost:3120/api/enterprise/action'),
  )
  vi.mocked(serverSupabaseClient).mockImplementation(async () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => {
        membershipCalls++
        return {
          data: role ? { role } : null,
          error: unavailable ? { message: 'unavailable' } : null,
        }
      },
    }
    return {
      auth: {
        getUser: async () => {
          authCalls++
          return { data: { user: { id: actor } }, error: null }
        },
      },
      from: () => q,
    } as never
  })
  vi.mocked(serverSupabaseServiceRole).mockImplementation(
    () =>
      ({
        rpc: async () => {
          deniedCalls++
          throw Error('audit unavailable')
        },
      }) as never,
  )
})
beforeEach(() => {
  role = 'owner'
  authCalls = membershipCalls = deniedCalls = 0
  unavailable = false
  vi.stubEnv('STRUCT_ENTERPRISE_ENABLED', 'false')
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it('deduplicates session/membership only inside one request and checks each capability independently', async () => {
  const e = event()
  await Promise.all([
    requireOrgWriter(e, org, 'devices.create'),
    requireOrgWriter(e, org, 'members.read'),
  ])
  expect(authCalls).toBe(1)
  expect(membershipCalls).toBe(1)
  role = 'viewer'
  await expect(
    requireOrgWriter(event(), org, 'devices.create'),
  ).rejects.toMatchObject({ statusCode: 403 })
  expect(membershipCalls).toBe(2)
})
it('fails closed on unknown capability, missing membership and database unavailability', async () => {
  await expect(requireOrgWriter(event(), org)).rejects.toMatchObject({
    statusCode: 403,
  })
  role = null
  await expect(
    requireOrgWriter(event(), org, 'devices.read'),
  ).rejects.toMatchObject({ statusCode: 403 })
  unavailable = true
  await expect(
    requireOrgWriter(event(), org, 'devices.read'),
  ).rejects.toMatchObject({ statusCode: 503 })
})
it('a failed bounded denial audit never grants access', async () => {
  vi.stubEnv('STRUCT_ENTERPRISE_ENABLED', 'true')
  role = 'operator'
  await expect(
    requireOrgWriter(event(), org, 'api_keys.manage'),
  ).rejects.toMatchObject({ statusCode: 403 })
  expect(deniedCalls).toBe(1)
})
it('accepts same-site bounded JSON and rejects cross-site, mismatched origin and oversized/nonobject input', async () => {
  expect(
    await enterpriseBody(
      event({ action: 'invite' }, { origin: 'http://localhost:3120' }),
    ),
  ).toEqual({ action: 'invite' })
  await expect(
    enterpriseBody(event({}, { 'sec-fetch-site': 'cross-site' })),
  ).rejects.toMatchObject({ statusCode: 400 })
  await expect(
    enterpriseBody(event({}, { origin: 'https://attacker.invalid' })),
  ).rejects.toMatchObject({ statusCode: 403 })
  await expect(
    enterpriseBody(event({ value: 'x'.repeat(16384) })),
  ).rejects.toMatchObject({ statusCode: 413 })
  await expect(enterpriseBody(event('[]'))).rejects.toMatchObject({
    statusCode: 400,
  })
})
it('creates independent 256-bit tokens, hashes exact bytes and rejects malformed credentials', () => {
  const a = newManagementSecret(),
    b = newManagementSecret()
  expect(a.secret).toHaveLength(64)
  expect(a.secret).not.toBe(b.secret)
  expect(parseManagementSecret(a.token)).toEqual({ id: a.id, hash: a.hash })
  expect(() => parseManagementSecret(a.token + 'x')).toThrow()
  expect(() => parseManagementSecret('http://secret.invalid')).toThrow()
})
it('validates the configured invitation origin without using a caller redirect', () => {
  vi.stubEnv('STRUCT_APP_URL', 'https://private.example.invalid')
  expect(applicationOrigin()).toBe('https://private.example.invalid')
  for (const value of [
    'http://external.invalid',
    'https://user:password@example.invalid',
    'https://example.invalid/path',
    'https://example.invalid?token=secret',
  ]) {
    vi.stubEnv('STRUCT_APP_URL', value)
    expect(() => applicationOrigin()).toThrow()
  }
})
it('bounds per-principal requests and sanitizes backend error text', () => {
  enterpriseRate('unit-test-unique', 1)
  expect(() => enterpriseRate('unit-test-unique', 1)).toThrow()
  expect(() =>
    enterpriseError({ message: 'INVALID_MANAGEMENT_KEY private secret' }),
  ).toThrow('invalid management key')
  try {
    enterpriseError({ message: 'connection password=secret' })
  } catch (e: any) {
    expect(e.message).toBe('enterprise operation failed')
    expect(e.message).not.toContain('secret')
  }
})

it('HTTP invitation and machine routes send PostgreSQL bytea hashes with exactly one prefix escape', async () => {
  vi.stubEnv('STRUCT_ENTERPRISE_ENABLED', 'true')
  const secret = newManagementSecret(),
    calls: any[] = []
  vi.mocked(serverSupabaseServiceRole).mockImplementation(
    () =>
      ({
        rpc: async (name: string, args: any) => {
          calls.push({ name, args })
          return { data: org, error: null }
        },
      }) as never,
  )
  const accept = (await import('../api/enterprise/accept.post')).default
  await (accept as any)(event({ token: secret.token }))
  const machine = (await import('../api/enterprise/v1/request.post')).default
  await (machine as any)(
    event(
      { action: 'inventory' },
      { authorization: 'Bearer stk_' + secret.token },
    ),
  )
  expect(calls.map((c) => c.args.p_hash)).toEqual([
    '\\x' + secret.hash,
    '\\x' + secret.hash,
  ])
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serverSupabaseClient } from '#supabase/server'
import { authorizeSecureV2Device, createSecureV2Credential, exportSecureV2Credential, requireSecureV2Available, secureV2Available, validateSecureV2Slot } from './secureV2'
import { decryptApiSecret } from './deviceCredentials'

const event = {} as H3Event
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('createError', ({ message, statusCode }: { message: string; statusCode: number }) => Object.assign(new Error(message), { statusCode }))
  vi.stubGlobal('useRuntimeConfig', () => ({ secureV2Enabled: false }))
})

function clientWithRole(role: string | null) {
  const membership: any = { eq: vi.fn(() => membership), select: vi.fn(() => membership), maybeSingle: vi.fn(async () => ({ data: role ? { role } : null })) }
  const client = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user_1' } }, error: null })) }, from: vi.fn(() => membership) }
  vi.mocked(serverSupabaseClient).mockResolvedValue(client as never)
  return { client, membership }
}
function serviceWithDevice(device: unknown = { id: 'device_1', organization_id: 'org_1', name: 'Sensor' }) {
  const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: device, error: null })) }
  const service = { from: vi.fn(() => query) }
  return { service: service as unknown as SupabaseClient, from: service.from, query }
}

describe('Secure V2 control plane', () => {
  it.each([false, 'false', undefined])('does not treat a disabled runtime flag as truthy: %s', (flag) => {
    vi.stubGlobal('useRuntimeConfig', () => ({ secureV2Enabled: flag }))
    expect(secureV2Available()).toBe(false)
    expect(() => requireSecureV2Available()).toThrow('not enabled')
  })
  it.each([true, 'true'])('accepts an explicit enabled flag: %s', (flag) => {
    vi.stubGlobal('useRuntimeConfig', () => ({ secureV2Enabled: flag }))
    expect(secureV2Available()).toBe(true)
  })
  it.each(['viewer', null])('refuses credential mutation/export without a writer role: %s', async (role) => {
    clientWithRole(role)
    const { service, from } = serviceWithDevice()
    await expect(authorizeSecureV2Device(event, service, 'device_1', 'org_1')).rejects.toMatchObject({ statusCode: 403 })
    expect(from).not.toHaveBeenCalled()
  })
  it('allows viewer metadata access while still constraining device lookup to the authorized organization', async () => {
    const { membership } = clientWithRole('viewer')
    const { service, query } = serviceWithDevice()
    expect((await authorizeSecureV2Device(event, service, 'device_1', 'org_1', false)).id).toBe('device_1')
    expect(membership.eq).toHaveBeenCalledWith('organization_id', 'org_1')
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'org_1')
    expect(query.eq).toHaveBeenCalledWith('id', 'device_1')
  })
  it('does not authorize a foreign device even when the caller writes another organization', async () => {
    clientWithRole('owner')
    const { service } = serviceWithDevice(null)
    await expect(authorizeSecureV2Device(event, service, 'foreign_device', 'org_1')).rejects.toMatchObject({ statusCode: 404 })
  })
  it('creates independent random secrets encrypted by the existing at-rest envelope', () => {
    const previous = process.env.TCP_CREDENTIAL_KEY
    process.env.TCP_CREDENTIAL_KEY = 'ab'.repeat(32)
    try {
      const first = createSecureV2Credential(), second = createSecureV2Credential()
      expect(first.rootSecret).toMatch(/^[a-f0-9]{64}$/)
      expect(first.bootstrapToken).toMatch(/^[a-f0-9]{64}$/)
      expect(first.rootSecret).not.toBe(second.rootSecret)
      expect(first.rootSecret).not.toBe(first.bootstrapToken)
      expect(first.rootEncrypted).not.toContain(first.rootSecret)
      expect(first.bootstrapEncrypted).not.toContain(first.bootstrapToken)
      expect(decryptApiSecret(first.rootEncrypted)).toBe(first.rootSecret)
      expect(exportSecureV2Credential({ wire_device_id: 123, root_secret_encrypted: first.rootEncrypted,
        bootstrap_token_encrypted: first.bootstrapEncrypted })).toEqual({ wireDeviceId: 123, rootSecret: first.rootSecret, bootstrapToken: first.bootstrapToken })
    } finally {
      if (previous === undefined) delete process.env.TCP_CREDENTIAL_KEY
      else process.env.TCP_CREDENTIAL_KEY = previous
    }
  })
  it('publishes explicit legacy9-byte and packed3-byte schemas without changing legacy semantics', () => {
    const legacy = [{ name: 'temperature', type: 'float32' }, { name: 'humidity', type: 'float32' }, { name: 'active', type: 'boolean' }]
    expect(validateSecureV2Slot({ slot: 0, encoding: 'legacy-le-v1', schemaDefinition: legacy }).bytes).toBe(9)
    const packed = [{ name: 'temperature', type: 'fixed', min: -40, max: 125, precision: 0.1 },
      { name: 'humidity', type: 'fixed', min: 0, max: 100, precision: 0.1 }, { name: 'active', type: 'boolean' }]
    expect(validateSecureV2Slot({ slot: 1, encoding: 'bitpacked-v1', schemaDefinition: packed }).bytes).toBe(3)
  })
  it.each([
    { slot: 16, encoding: 'bitpacked-v1', schemaDefinition: [{ name: 'active', type: 'boolean' }] },
    { slot: 0, encoding: 'bitpacked-v1', schemaDefinition: [{ name: 'n', type: 'fixed', min: 0, max: 1, precision: 0 }] },
    { slot: 0, encoding: 'bitpacked-v1', schemaDefinition: [{ name: 'n', type: 'uint', width: 65 }] },
    { slot: 0, encoding: 'bitpacked-v1', schemaDefinition: [] },
    { slot: 0, encoding: 'unknown', schemaDefinition: [] },
    { slot: 0, encoding: 'bitpacked-v1', schemaDefinition: [{ name: '__proto__', type: 'boolean' }] },
    { slot: 0, encoding: 'bitpacked-v1', schemaDefinition: [{ name: 'active', type: 'boolean' }], sampleIntervalMs: -1 },
  ])('rejects an invalid publication before database access: %j', (body) => {
    expect(() => validateSecureV2Slot(body)).toThrow()
  })
})

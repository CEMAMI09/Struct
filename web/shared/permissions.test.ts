import { it, expect } from 'vitest'
import { ROLE_PERMISSIONS, hasPermission } from './permissions'
import {
  generateSecureV2Project,
  generateSecureV2NodeProject,
} from './secureV2Project'
import { safeAuthDestination } from '../app/utils/postAuthRedirect'
const credentials = {
    wireDeviceId: 1,
    rootSecret: '01'.repeat(32),
    bootstrapToken: '02'.repeat(32),
  },
  slot: any = {
    slot: 0,
    encoding: 'bitpacked-v1',
    record_bytes: 1,
    schema_definition: [{ name: 'v', type: 'uint', width: 8 }],
  }
it('denies unknown roles and capabilities including the default unclassified operation', () => {
  for (const role of [null, undefined, 'unknown', 'constructor', '__proto__'])
    expect(hasPermission(role, 'devices.read')).toBe(false)
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    expect(hasPermission(role, 'unclassified')).toBe(false)
    expect(hasPermission(role, 'new.sensitive.operation')).toBe(false)
  }
})
it('separates developer provisioning from bulk exports and billing', () => {
  expect(hasPermission('developer', 'devices.provision')).toBe(true)
  expect(hasPermission('developer', 'devices.export_credentials')).toBe(false)
  expect(hasPermission('developer', 'billing.manage')).toBe(false)
})
it('separates operator retry/acknowledgment from replay and secret access', () => {
  expect(hasPermission('operator', 'delivery.retry')).toBe(true)
  expect(hasPermission('operator', 'alerts.acknowledge')).toBe(true)
  for (const c of [
    'delivery.replay',
    'devices.provision',
    'alerts.manage',
    'api_keys.manage',
  ])
    expect(hasPermission('operator', c)).toBe(false)
})
it('keeps owner controls separate from administrators', () => {
  expect(hasPermission('admin', 'members.invite')).toBe(true)
  expect(hasPermission('admin', 'members.manage_admins')).toBe(false)
  expect(hasPermission('owner', 'organization.transfer')).toBe(true)
})
it('only adds the exact internal invite destination to safe auth redirects', () => {
  expect(safeAuthDestination('/invite')).toBe('/invite')
  for (const p of [
    '//evil.invalid/invite',
    '/invite?redirect=https://evil.invalid',
    '/invite/anything',
    'https://evil.invalid/invite',
  ])
    expect(safeAuthDestination(p)).toBe('/dashboard')
})
it('configures real SDK host/port/bootstrap without weakening TLS or changing wire defaults', () => {
  const endpoint = {
      host: 'ingest.customer.example',
      port: 9081,
      bootstrapOrigin: 'https://console.customer.example',
    },
    c = generateSecureV2Project({
      slot,
      credentials,
      board: 'esp32dev',
      endpoint,
    })
  expect(c['include/struct_config.h']).toContain('STRUCT_CONFIG_UDP_PORT 9081u')
  expect(c['src/main.cpp']).toContain('STRUCT_CONFIG_BOOTSTRAP_URL')
  expect(c['src/main.cpp']).not.toContain('setInsecure')
  const node = generateSecureV2NodeProject({ slot, credentials, endpoint })
  expect(JSON.parse(node['private-config.json']!)).toMatchObject(endpoint)
  expect(() =>
    generateSecureV2Project({
      slot,
      credentials,
      board: 'esp32dev',
      endpoint: { ...endpoint, bootstrapOrigin: 'http://insecure.example' },
    }),
  ).toThrow()
})

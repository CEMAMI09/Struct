import { describe, expect, it } from 'vitest'
import { encryptApiSecret, recoverDeviceCredentials, sanitizeDeviceForClient } from './deviceCredentials'

describe('device response sanitization', () => {
  it('does not return stored credential or encryption material', () => {
    const row = {
      id: 'device-1',
      key_id: 'public-id',
      api_secret_encrypted: 'ciphertext',
      encryption_key: 'private-key',
      fleet_secret_encrypted: 'fleet-ciphertext',
    }
    expect(sanitizeDeviceForClient(row)).toEqual({ id: 'device-1', key_id: 'public-id' })
    expect(row.api_secret_encrypted).toBe('ciphertext')
  })

  it('can recover an import credential from encrypted storage after a lost response', () => {
    const previous = process.env.TCP_CREDENTIAL_KEY
    process.env.TCP_CREDENTIAL_KEY = 'ab'.repeat(32)
    try {
      const devices = [{
        id: 'device-1',
        name: 'sensor',
        key_id: 'public-id',
        api_secret_encrypted: encryptApiSecret('one-time-secret'),
      }]
      expect(recoverDeviceCredentials(devices)).toEqual([{
        deviceId: 'device-1',
        name: 'sensor',
        keyId: 'public-id',
        apiSecret: 'one-time-secret',
      }])
    } finally {
      if (previous === undefined) delete process.env.TCP_CREDENTIAL_KEY
      else process.env.TCP_CREDENTIAL_KEY = previous
    }
  })
})

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mapRecordsToProfileBulkRows, normalizeHardwareId } from '../../shared/profileBulkUpload'
import { hardwareIdFromIdentityValue } from './zeroTouch'

const require = createRequire(import.meta.url)
const gatewayHardwareIdFromIdentityValue = require('../../../tcp-server/zeroTouch.js')
  .hardwareIdFromIdentityValue as (value: unknown) => string | null

describe('zero-touch identity normalization', () => {
  it('preserves distinct opaque IDs in the web, gateway and CSV paths', () => {
    const ids = ['AB-1', 'AB1', 'AA:BB', 'AABB', 'AB', 'ab', ' AB ', '1.25']
    for (const id of ids) {
      expect(hardwareIdFromIdentityValue(id)).toBe(id)
      expect(gatewayHardwareIdFromIdentityValue(id)).toBe(id)
      expect(normalizeHardwareId(id)).toBe(id)
    }

    const csv = mapRecordsToProfileBulkRows(
      ids.map((id) => ({ 'Serial Number': id })),
      ['Serial Number'],
    )
    expect(csv.fileErrors).toEqual([])
    expect(csv.rows.every((row) => row.errors.length === 0)).toBe(true)
    expect(csv.validDevices.map((device) => device.hardware_id)).toEqual(ids)
  })

  it('rejects control characters and blank identities in every path', () => {
    for (const value of ['AB\u0001', '\tAB', '  ', '']) {
      expect(hardwareIdFromIdentityValue(value)).toBeNull()
      expect(gatewayHardwareIdFromIdentityValue(value)).toBeNull()
      expect(normalizeHardwareId(value)).toBeNull()
    }
  })

  it('does not truncate distinct numeric identities', () => {
    expect(hardwareIdFromIdentityValue(1.25)).toBe('1.25')
    expect(hardwareIdFromIdentityValue(1.75)).toBe('1.75')
    expect(gatewayHardwareIdFromIdentityValue(1.25)).toBe('1.25')
    expect(gatewayHardwareIdFromIdentityValue(1.75)).toBe('1.75')
  })
})

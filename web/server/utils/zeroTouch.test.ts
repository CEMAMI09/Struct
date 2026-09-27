import { describe, expect, it } from 'vitest'
import { hardwareIdFromIdentityValue } from './zeroTouch'

describe('zero-touch identity normalization', () => {
  it('keeps punctuation that distinguishes opaque hardware IDs', () => {
    expect(hardwareIdFromIdentityValue('AB-1')).toBe('AB-1')
    expect(hardwareIdFromIdentityValue('AB1')).toBe('AB1')
    expect(hardwareIdFromIdentityValue('AA:BB')).toBe('AA:BB')
    expect(hardwareIdFromIdentityValue('AABB')).toBe('AABB')
    expect(hardwareIdFromIdentityValue('ab1')).toBe('ab1')
  })

  it('rejects control characters in decoded identities', () => {
    expect(hardwareIdFromIdentityValue('AB\u0001')).toBeNull()
  })

  it('does not truncate distinct numeric identities', () => {
    expect(hardwareIdFromIdentityValue(1.25)).toBe('1.25')
    expect(hardwareIdFromIdentityValue(1.75)).toBe('1.75')
  })
})

import { expect, it } from 'vitest'
import { packDownlinkCommandHex } from './useDownlinks'

it('rejects intervals that would truncate or wrap on the wire', () => {
  for (const interval_sec of [-1, 0, 1.5, NaN, Infinity, 4294967296]) {
    expect(() => packDownlinkCommandHex('set_interval', { interval_sec })).toThrow('whole number')
  }
  expect(packDownlinkCommandHex('set_interval', { interval_sec: 60 })).toBe('013c000000')
  expect(packDownlinkCommandHex('set_interval', { interval_sec: 4294967295 })).toBe('01ffffffff')
  expect(() => packDownlinkCommandHex('typo', {})).toThrow('Unsupported')
})

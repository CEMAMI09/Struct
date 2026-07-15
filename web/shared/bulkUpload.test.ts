import { describe, expect, it } from 'vitest'
import {
  BULK_UPLOAD_MAX_ROWS,
  buildCsvTemplate,
  formatMacAddress,
  mapRecordsToBulkRows,
  normalizeHeader,
  normalizeMacAddress,
  parseTagsCell,
  validateBulkDevices,
} from './bulkUpload'

describe('normalizeHeader', () => {
  it('accepts aliases', () => {
    expect(normalizeHeader('Device Name')).toBe('Device Name')
    expect(normalizeHeader('name')).toBe('Device Name')
    expect(normalizeHeader('MAC_Address')).toBe('MAC Address')
    expect(normalizeHeader('mac')).toBe('MAC Address')
    expect(normalizeHeader('Tags')).toBe('Tags')
  })

  it('rejects unknown headers', () => {
    expect(normalizeHeader('Firmware')).toBeNull()
  })
})

describe('normalizeMacAddress', () => {
  it('canonicalizes common formats', () => {
    expect(normalizeMacAddress('AA:BB:CC:DD:EE:FF')).toBe('aabbccddeeff')
    expect(normalizeMacAddress('aa-bb-cc-dd-ee-ff')).toBe('aabbccddeeff')
    expect(normalizeMacAddress('AABBCCDDEEFF')).toBe('aabbccddeeff')
  })

  it('rejects invalid MACs', () => {
    expect(normalizeMacAddress('aa:bb:cc')).toBeNull()
    expect(normalizeMacAddress('gg:bb:cc:dd:ee:ff')).toBeNull()
    expect(normalizeMacAddress('')).toBeNull()
  })
})

describe('parseTagsCell', () => {
  it('parses key=value pairs', () => {
    expect(parseTagsCell('Location=Chicago_Factory;Version=v1.0.4')).toEqual({
      tags: { Location: 'Chicago_Factory', Version: 'v1.0.4' },
    })
  })

  it('rejects malformed tags', () => {
    expect(parseTagsCell('not-a-tag').error).toMatch(/Invalid tag/)
  })
})

describe('mapRecordsToBulkRows', () => {
  it('maps valid CSV-like records', () => {
    const result = mapRecordsToBulkRows(
      [
        {
          'Device Name': 'Sensor A',
          'MAC Address': '11:22:33:44:55:66',
          Tags: 'Location=Lab',
        },
      ],
      ['Device Name', 'MAC Address', 'Tags'],
    )
    expect(result.fileErrors).toEqual([])
    expect(result.validDevices).toHaveLength(1)
    expect(result.validDevices[0]?.mac_address).toBe('112233445566')
    expect(formatMacAddress(result.validDevices[0]!.mac_address)).toBe(
      '11:22:33:44:55:66',
    )
  })

  it('flags missing columns and duplicates', () => {
    const missing = mapRecordsToBulkRows([{ name: 'A' }], ['name'])
    expect(missing.fileErrors.some((e) => e.includes('MAC Address'))).toBe(true)

    const dupes = mapRecordsToBulkRows(
      [
        {
          'Device Name': 'A',
          'MAC Address': '11:22:33:44:55:66',
          Tags: '',
        },
        {
          'Device Name': 'B',
          'MAC Address': '112233445566',
          Tags: '',
        },
      ],
      ['Device Name', 'MAC Address', 'Tags'],
    )
    expect(dupes.errors.some((e) => e.message.includes('Duplicate'))).toBe(true)
    expect(dupes.validDevices).toHaveLength(1)
  })

  it('enforces the 1000-row batch limit', () => {
    const records = Array.from({ length: BULK_UPLOAD_MAX_ROWS + 1 }, (_, i) => ({
      'Device Name': `Device ${i}`,
      'MAC Address': i.toString(16).padStart(12, '0'),
      Tags: '',
    }))
    const result = mapRecordsToBulkRows(records, [
      'Device Name',
      'MAC Address',
      'Tags',
    ])
    expect(result.fileErrors[0]).toMatch(/Batch limit/)
  })
})

describe('validateBulkDevices', () => {
  it('returns canonical valid rows', () => {
    const { valid, errors } = validateBulkDevices([
      {
        name: '  Pump 1 ',
        mac_address: 'AA:BB:CC:DD:EE:01',
        tags: { Site: 'A' },
      },
    ])
    expect(errors).toEqual([])
    expect(valid[0]).toEqual({
      name: 'Pump 1',
      mac_address: 'aabbccddee01',
      tags: { Site: 'A' },
    })
  })
})

describe('buildCsvTemplate', () => {
  it('includes required headers', () => {
    const csv = buildCsvTemplate()
    expect(csv).toContain('Device Name,MAC Address,Tags')
  })
})

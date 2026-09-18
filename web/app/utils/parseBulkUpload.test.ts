import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseBulkUploadFile } from './parseBulkUpload'
describe('spreadsheet import', () => {
  it('keeps column positions when an unnamed column separates named columns', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Device Name', '', 'MAC Address', 'Tags'],
      ['Test sensor', 'ignored', 'AA:BB:CC:DD:EE:FF', 'location=lab'],
    ]), 'Devices')
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([bytes], 'devices.xlsx')
    const parsed = await parseBulkUploadFile(file)
    expect(parsed.validDevices[0]?.mac_address).toBe('aabbccddeeff')
    expect(parsed.validDevices[0]?.name).toBe('Test sensor')
  })
  it('rejects files beyond the size limit before reading contents', async () => {
    const result = await parseBulkUploadFile({ size: 6 * 1024 * 1024, name: 'big.xlsx' } as File)
    expect(result.fileErrors[0]).toContain('5 MB')
  })
})

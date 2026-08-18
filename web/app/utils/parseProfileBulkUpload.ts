import Papa from 'papaparse'
import {
  buildProfileCsvTemplate,
  detectCsvDelimiter,
  mapRecordsToProfileBulkRows,
  type ProfileBulkParseResult,
} from '#shared/profileBulkUpload'

export { buildProfileCsvTemplate }
export type { ProfileBulkParseResult }

async function parseCsvFile(file: File): Promise<ProfileBulkParseResult> {
  const text = await file.text()
  const delimiter = detectCsvDelimiter(text)
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter,
    transformHeader: (h) => h.trim(),
  })

  if (parsed.errors.length) {
    const first = parsed.errors[0]
    return {
      rows: [],
      validDevices: [],
      fileErrors: [first?.message || 'Failed to parse CSV'],
      headers: [],
      columnMap: {},
    }
  }

  const headers = parsed.meta.fields || []
  const records = (parsed.data || []).filter((row) =>
    Object.values(row).some((v) => String(v ?? '').trim() !== ''),
  )
  return mapRecordsToProfileBulkRows(records, headers)
}

export async function parseProfileBulkUploadFile(file: File): Promise<ProfileBulkParseResult> {
  const name = file.name.toLowerCase()
  if (!name.endsWith('.csv') && file.type !== 'text/csv') {
    return {
      rows: [],
      validDevices: [],
      fileErrors: ['Unsupported file type. Upload a .csv file.'],
      headers: [],
      columnMap: {},
    }
  }
  return parseCsvFile(file)
}

export function downloadProfileBulkTemplate() {
  const csv = buildProfileCsvTemplate()
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'struct-profile-provisioning-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

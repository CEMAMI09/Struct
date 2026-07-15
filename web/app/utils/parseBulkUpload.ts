import Papa from 'papaparse'
import {
  buildCsvTemplate,
  mapRecordsToBulkRows,
  type BulkParseResult,
} from '#shared/bulkUpload'

export { buildCsvTemplate }
export type { BulkParseResult }

function extensionOf(file: File) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx'
  return null
}

async function parseCsvFile(file: File): Promise<BulkParseResult> {
  const text = await file.text()
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  if (parsed.errors.length) {
    const first = parsed.errors[0]
    return {
      rows: [],
      errors: [],
      validDevices: [],
      fileErrors: [first?.message || 'Failed to parse CSV'],
    }
  }

  const headers = parsed.meta.fields || []
  const records = (parsed.data || []).filter((row) =>
    Object.values(row).some((v) => String(v ?? '').trim() !== ''),
  )
  return mapRecordsToBulkRows(records, headers)
}

async function parseXlsxFile(file: File): Promise<BulkParseResult> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return {
      rows: [],
      errors: [],
      validDevices: [],
      fileErrors: ['Workbook has no sheets'],
    }
  }
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      rows: [],
      errors: [],
      validDevices: [],
      fileErrors: ['Workbook sheet is empty'],
    }
  }

  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  })

  if (!rows.length) {
    return {
      rows: [],
      errors: [],
      validDevices: [],
      fileErrors: ['File has no data rows'],
    }
  }

  const headerCells = (rows[0] || []).map((cell) => String(cell ?? '').trim())
  const headers = headerCells.filter((h) => h)
  if (!headers.length) {
    return {
      rows: [],
      errors: [],
      validDevices: [],
      fileErrors: ['Missing header row'],
    }
  }

  const records: Record<string, unknown>[] = []
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i] || []
    const record: Record<string, unknown> = {}
    let empty = true
    headers.forEach((header, idx) => {
      const value = String(cells[idx] ?? '').trim()
      record[header] = value
      if (value) empty = false
    })
    if (!empty) records.push(record)
  }

  return mapRecordsToBulkRows(records, headers)
}

export async function parseBulkUploadFile(file: File): Promise<BulkParseResult> {
  const ext = extensionOf(file)
  if (!ext) {
    return {
      rows: [],
      errors: [],
      validDevices: [],
      fileErrors: ['Unsupported file type. Upload a .csv or .xlsx file.'],
    }
  }

  if (ext === 'csv') return parseCsvFile(file)
  return parseXlsxFile(file)
}

export function downloadBulkTemplate() {
  const csv = buildCsvTemplate()
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'struct-devices-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

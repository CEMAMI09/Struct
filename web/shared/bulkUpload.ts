export const BULK_UPLOAD_MAX_ROWS = 1000
export const BULK_UPLOAD_TEMPLATE_HEADERS = [
  'Device Name',
  'MAC Address',
  'Tags',
] as const

export type BulkUploadHeader = (typeof BULK_UPLOAD_TEMPLATE_HEADERS)[number]

export interface BulkDeviceInput {
  name: string
  mac_address: string
  tags: Record<string, string>
}

export interface BulkRowError {
  row: number
  field?: string
  message: string
}

export interface ParsedBulkRow {
  row: number
  name: string
  mac_address: string
  macDisplay: string
  tags: Record<string, string>
  tagsRaw: string
  errors: string[]
}

export interface BulkParseResult {
  rows: ParsedBulkRow[]
  errors: BulkRowError[]
  validDevices: BulkDeviceInput[]
  fileErrors: string[]
}

const HEADER_ALIASES: Record<string, BulkUploadHeader> = {
  'device name': 'Device Name',
  name: 'Device Name',
  device: 'Device Name',
  'mac address': 'MAC Address',
  mac: 'MAC Address',
  macaddress: 'MAC Address',
  'mac_address': 'MAC Address',
  tags: 'Tags',
  tag: 'Tags',
}

export function normalizeHeader(value: unknown): BulkUploadHeader | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  return HEADER_ALIASES[key] ?? null
}

/** Canonical 12-char lowercase hex, or null if invalid. */
export function normalizeMacAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().toLowerCase().replace(/[^0-9a-f]/g, '')
  if (hex.length !== 12) return null
  return hex
}

export function formatMacAddress(mac: string): string {
  const normalized = normalizeMacAddress(mac)
  if (!normalized) return mac
  return normalized.match(/.{1,2}/g)!.join(':')
}

export function parseTagsCell(value: unknown): {
  tags: Record<string, string>
  error?: string
} {
  if (value == null || value === '') {
    return { tags: {} }
  }
  if (typeof value !== 'string') {
    return { tags: {}, error: 'Tags must be text like key=value;key=value' }
  }

  const raw = value.trim()
  if (!raw) return { tags: {} }

  const tags: Record<string, string> = {}
  const parts = raw.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) {
      return {
        tags: {},
        error: `Invalid tag "${trimmed}" — use key=value;key=value`,
      }
    }
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!key) {
      return { tags: {}, error: 'Tag keys cannot be empty' }
    }
    tags[key] = val
  }
  return { tags }
}

export function serializeTags(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([key, value]) => `${key}=${value}`)
    .join(';')
}

export function buildCsvTemplate(): string {
  const header = BULK_UPLOAD_TEMPLATE_HEADERS.join(',')
  const example = [
    'ESP32 Kitchen',
    'AA:BB:CC:DD:EE:01',
    'Location=Chicago_Factory;Version=v1.0.4',
  ].join(',')
  return `${header}\n${example}\n`
}

export function hashBulkDevices(devices: BulkDeviceInput[]): string {
  const canonical = devices
    .map((d) => ({
      name: d.name.trim(),
      mac_address: d.mac_address,
      tags: Object.keys(d.tags)
        .sort()
        .reduce<Record<string, string>>((acc, key) => {
          acc[key] = d.tags[key]!
          return acc
        }, {}),
    }))
    .sort((a, b) => a.mac_address.localeCompare(b.mac_address))
  return stableStringify(canonical)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function validateBulkDevices(
  devices: BulkDeviceInput[],
): { valid: BulkDeviceInput[]; errors: BulkRowError[] } {
  const errors: BulkRowError[] = []
  const valid: BulkDeviceInput[] = []
  const seen = new Map<string, number>()

  if (devices.length > BULK_UPLOAD_MAX_ROWS) {
    errors.push({
      row: 0,
      message: `Batch limit is ${BULK_UPLOAD_MAX_ROWS} devices (got ${devices.length})`,
    })
    return { valid: [], errors }
  }

  devices.forEach((device, index) => {
    const row = index + 1
    const name = typeof device.name === 'string' ? device.name.trim() : ''
    const mac = normalizeMacAddress(device.mac_address)
    const tags =
      device.tags && typeof device.tags === 'object' && !Array.isArray(device.tags)
        ? Object.fromEntries(
            Object.entries(device.tags)
              .filter(([k, v]) => typeof k === 'string' && typeof v === 'string')
              .map(([k, v]) => [k.trim(), String(v).trim()])
              .filter(([k]) => k),
          )
        : null

    const rowErrors: string[] = []
    if (!name) rowErrors.push('Device Name is required')
    if (!mac) rowErrors.push('MAC Address must be 6 octets (e.g. AA:BB:CC:DD:EE:FF)')
    if (tags == null) rowErrors.push('Tags must be an object of string key/value pairs')

    if (mac) {
      const prior = seen.get(mac)
      if (prior != null) {
        rowErrors.push(`Duplicate MAC Address (also on row ${prior})`)
      } else {
        seen.set(mac, row)
      }
    }

    if (rowErrors.length) {
      for (const message of rowErrors) {
        errors.push({ row, message })
      }
      return
    }

    valid.push({
      name,
      mac_address: mac!,
      tags: tags || {},
    })
  })

  return { valid, errors }
}

export function mapRecordsToBulkRows(
  records: Record<string, unknown>[],
  headers: string[],
): BulkParseResult {
  const fileErrors: string[] = []
  const mappedHeaders = headers.map(normalizeHeader)
  const present = new Set(mappedHeaders.filter(Boolean) as BulkUploadHeader[])

  for (const required of BULK_UPLOAD_TEMPLATE_HEADERS) {
    if (!present.has(required)) {
      fileErrors.push(`Missing required column: ${required}`)
    }
  }

  const unknown = headers.filter((h, i) => h.trim() && !mappedHeaders[i])
  if (unknown.length) {
    fileErrors.push(`Unknown column(s): ${unknown.join(', ')}`)
  }

  if (fileErrors.length) {
    return { rows: [], errors: [], validDevices: [], fileErrors }
  }

  if (records.length > BULK_UPLOAD_MAX_ROWS) {
    return {
      rows: [],
      errors: [],
      validDevices: [],
      fileErrors: [
        `Batch limit is ${BULK_UPLOAD_MAX_ROWS} devices (got ${records.length})`,
      ],
    }
  }

  const nameKey = headers.find((_, i) => mappedHeaders[i] === 'Device Name')!
  const macKey = headers.find((_, i) => mappedHeaders[i] === 'MAC Address')!
  const tagsKey = headers.find((_, i) => mappedHeaders[i] === 'Tags')!

  const rows: ParsedBulkRow[] = []
  const errors: BulkRowError[] = []
  const seen = new Map<string, number>()

  records.forEach((record, index) => {
    const row = index + 2 // 1-based data rows with header on line 1
    const name = String(record[nameKey] ?? '').trim()
    const macRaw = String(record[macKey] ?? '').trim()
    const mac = normalizeMacAddress(macRaw)
    const tagsRaw = String(record[tagsKey] ?? '').trim()
    const parsedTags = parseTagsCell(tagsRaw)
    const rowErrors: string[] = []

    if (!name) rowErrors.push('Device Name is required')
    if (!mac) {
      rowErrors.push('MAC Address must be 6 octets (e.g. AA:BB:CC:DD:EE:FF)')
    }
    if (parsedTags.error) rowErrors.push(parsedTags.error)

    if (mac) {
      const prior = seen.get(mac)
      if (prior != null) {
        rowErrors.push(`Duplicate MAC Address (also on row ${prior})`)
      } else {
        seen.set(mac, row)
      }
    }

    for (const message of rowErrors) {
      errors.push({ row, message })
    }

    rows.push({
      row,
      name,
      mac_address: mac || '',
      macDisplay: mac ? formatMacAddress(mac) : macRaw,
      tags: parsedTags.tags,
      tagsRaw,
      errors: rowErrors,
    })
  })

  if (!records.length) {
    fileErrors.push('File has no data rows')
  }

  const validDevices = rows
    .filter((r) => !r.errors.length)
    .map((r) => ({
      name: r.name,
      mac_address: r.mac_address,
      tags: r.tags,
    }))

  return { rows, errors, validDevices, fileErrors }
}

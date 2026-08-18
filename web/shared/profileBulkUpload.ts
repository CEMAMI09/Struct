export const PROFILE_BULK_MAX_ROWS = 5000
export const PROFILE_BULK_TEMPLATE_HEADERS = [
  'Serial Number',
  'Device Name',
  'MAC Address',
  'Tags',
] as const

export type ProfileBulkHeader = (typeof PROFILE_BULK_TEMPLATE_HEADERS)[number]

export interface ProfileBulkDeviceInput {
  name: string
  hardware_id: string
  mac_address?: string | null
  tags: Record<string, string>
}

export interface ParsedProfileBulkRow {
  row: number
  serial: string
  name: string
  mac_address: string
  macDisplay: string
  tags: Record<string, string>
  tagsRaw: string
  errors: string[]
}

export interface ProfileBulkParseResult {
  rows: ParsedProfileBulkRow[]
  validDevices: ProfileBulkDeviceInput[]
  fileErrors: string[]
  headers: string[]
  columnMap: Partial<Record<ProfileBulkHeader, string>>
}

const HEADER_ALIASES: Record<string, ProfileBulkHeader> = {
  'serial number': 'Serial Number',
  serial: 'Serial Number',
  serialnumber: 'Serial Number',
  'serial_number': 'Serial Number',
  hardware_id: 'Serial Number',
  'hardware id': 'Serial Number',
  'device id': 'Serial Number',
  device_id: 'Serial Number',
  'device name': 'Device Name',
  name: 'Device Name',
  device: 'Device Name',
  'mac address': 'MAC Address',
  mac: 'MAC Address',
  macaddress: 'MAC Address',
  mac_address: 'MAC Address',
  tags: 'Tags',
  tag: 'Tags',
}

export function normalizeProfileHeader(value: unknown): ProfileBulkHeader | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  return HEADER_ALIASES[key] ?? null
}

/** Canonical hardware id: lowercase alnum / hex, stripped of separators. */
export function normalizeHardwareId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().toLowerCase()
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9a-z]/g, '')
  if (cleaned.length < 2 || cleaned.length > 64) return null
  return cleaned
}

export function buildProfileCsvTemplate(): string {
  const header = PROFILE_BULK_TEMPLATE_HEADERS.join(',')
  const example = [
    'AABBCCDDEE01',
    'Unit-001',
    'AA:BB:CC:DD:EE:01',
    'Location=Chicago_Factory;Lot=2026Q1',
  ].join(',')
  return `${header}\n${example}\n`
}

/**
 * Detect CSV delimiter from the header line.
 * Prefers comma; falls back to semicolon/tab when comma is absent.
 */
export function detectCsvDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || ''
  const candidates = [',', ';', '\t'] as const
  let best = ','
  let bestCount = -1
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1
    if (count > bestCount) {
      bestCount = count
      best = d
    }
  }
  return best
}

export function mapRecordsToProfileBulkRows(
  records: Record<string, unknown>[],
  headers: string[],
): ProfileBulkParseResult {
  const fileErrors: string[] = []
  const mappedHeaders = headers.map(normalizeProfileHeader)
  const columnMap: Partial<Record<ProfileBulkHeader, string>> = {}

  headers.forEach((header, i) => {
    const mapped = mappedHeaders[i]
    if (mapped && !columnMap[mapped]) columnMap[mapped] = header
  })

  if (!columnMap['Serial Number']) {
    fileErrors.push('Missing required column: Serial Number')
  }

  const unknown = headers.filter((h, i) => h.trim() && !mappedHeaders[i])
  if (unknown.length) {
    fileErrors.push(`Unknown column(s): ${unknown.join(', ')}`)
  }

  if (fileErrors.length) {
    return { rows: [], validDevices: [], fileErrors, headers, columnMap }
  }

  if (records.length > PROFILE_BULK_MAX_ROWS) {
    return {
      rows: [],
      validDevices: [],
      fileErrors: [
        `Batch limit is ${PROFILE_BULK_MAX_ROWS} devices (got ${records.length})`,
      ],
      headers,
      columnMap,
    }
  }

  const serialKey = columnMap['Serial Number']!
  const nameKey = columnMap['Device Name']
  const macKey = columnMap['MAC Address']
  const tagsKey = columnMap['Tags']

  const rows: ParsedProfileBulkRow[] = []
  const seen = new Map<string, number>()

  records.forEach((record, index) => {
    const row = index + 2
    const serialRaw = String(record[serialKey] ?? '').trim()
    const serial = normalizeHardwareId(serialRaw)
    const nameRaw = nameKey ? String(record[nameKey] ?? '').trim() : ''
    const macRaw = macKey ? String(record[macKey] ?? '').trim() : ''
    const tagsRaw = tagsKey ? String(record[tagsKey] ?? '').trim() : ''

    const rowErrors: string[] = []
    if (!serial) {
      rowErrors.push('Serial Number must be 2–64 alphanumeric characters')
    }

    let mac = ''
    let macDisplay = ''
    if (macRaw) {
      const hex = macRaw.toLowerCase().replace(/[^0-9a-f]/g, '')
      if (hex.length !== 12) {
        rowErrors.push('MAC Address must be 6 octets when provided')
      } else {
        mac = hex
        macDisplay = hex.match(/.{1,2}/g)!.join(':')
      }
    }

    const tags: Record<string, string> = {}
    if (tagsRaw) {
      for (const part of tagsRaw.split(';')) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const eq = trimmed.indexOf('=')
        if (eq <= 0) {
          rowErrors.push(`Invalid tag "${trimmed}" — use key=value;key=value`)
          break
        }
        const key = trimmed.slice(0, eq).trim()
        const val = trimmed.slice(eq + 1).trim()
        if (!key) {
          rowErrors.push('Tag keys cannot be empty')
          break
        }
        tags[key] = val
      }
    }

    if (serial) {
      const prior = seen.get(serial)
      if (prior != null) {
        rowErrors.push(`Duplicate Serial Number (also on row ${prior})`)
      } else {
        seen.set(serial, row)
      }
    }

    rows.push({
      row,
      serial: serial || serialRaw,
      name: nameRaw || (serial ? `Unit-${serial}` : ''),
      mac_address: mac,
      macDisplay: macDisplay || macRaw,
      tags,
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
      hardware_id: r.serial,
      mac_address: r.mac_address || null,
      tags: r.tags,
    }))

  return { rows, validDevices, fileErrors, headers, columnMap }
}

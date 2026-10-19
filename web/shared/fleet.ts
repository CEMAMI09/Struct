export type FleetOperation =
  | 'create'
  | 'metadata'
  | 'groups_add'
  | 'groups_remove'
  | 'labels_add'
  | 'labels_remove'
  | 'enable'
  | 'disable'
  | 'revoke'
  | 'delete'
  | 'reprovision'
export interface FleetRow {
  name: string
  group?: string
  tags?: string
  external_id?: string
  serial_number?: string
  description?: string
  metadata?: Record<string, unknown>
  lifecycle?: 'enabled' | 'disabled'
}
export interface FleetDevice {
  id: string
  name: string
  external_id: string | null
  serial_number: string | null
  description: string
  labels: string[]
  lifecycle: string
  activity: string
  admin_version: number
  last_seen: string | null
  first_telemetry_at: string | null
  wire_device_id: number | null
  groups: { id: string; name: string }[]
  provisioning_exported_at: string | null
  credential_epoch_first_seen_at: string | null
}
export interface FleetItem {
  item_index: number
  input: FleetRow
  device_id: string | null
  expected_version: number | null
  status: string
  error_code: string | null
}
export interface FleetJob {
  id: string
  operation: FleetOperation
  status: string
  created_at: string
  completed_at: string | null
  expires_at: string
}
export interface FleetGroup {
  id: string
  name: string
  version: number
  count: number
}
export function manifestDeviceIds(
  operation: FleetOperation,
  items: Array<Pick<FleetItem, 'status' | 'device_id'>>,
) {
  const status =
    operation === 'create'
      ? 'created'
      : operation === 'reprovision'
        ? 'updated'
        : null
  return status
    ? [
        ...new Set(
          items
            .filter((i) => i.status === status && i.device_id)
            .map((i) => i.device_id!),
        ),
      ]
    : []
}
export const OPERATIONS: FleetOperation[] = [
  'create',
  'metadata',
  'groups_add',
  'groups_remove',
  'labels_add',
  'labels_remove',
  'enable',
  'disable',
  'revoke',
  'delete',
  'reprovision',
]
export interface FleetPreviewIntent {
  fingerprint: string
  requestId: string
  createdAt: number
}
// Persist only this digest/UUID, never raw CSV, metadata or device credentials.
export async function fleetPreviewIntent(
  body: Record<string, unknown>,
  previous: FleetPreviewIntent | null,
  now = Date.now(),
): Promise<FleetPreviewIntent> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(body)),
  )
  const fingerprint = Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('')
  if (
    previous?.fingerprint === fingerprint &&
    typeof previous.requestId === 'string' &&
    now >= previous.createdAt &&
    now - previous.createdAt < 30 * 60 * 1000
  )
    return previous
  return { fingerprint, requestId: crypto.randomUUID(), createdAt: now }
}
export function labels(value: string | string[]) {
  const result = [
    ...new Set(
      (typeof value === 'string' ? value.split(',') : value)
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  if (
    result.length > 20 ||
    result.some((v) => !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(v))
  )
    throw new Error(
      'Use at most 20 tags, each 1–48 lowercase letters, digits, dashes or underscores.',
    )
  return result
}
function safeText(
  value: unknown,
  max: number,
  required = false,
  multiline = false,
) {
  if (value == null && !required) return ''
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(
      value,
    ) ||
    (required && !value.trim())
  )
    throw new Error(
      `Expected ${required ? 'nonempty ' : ''}text of at most ${max} characters.`,
    )
  return value.trim()
}
export function deviceRow(value: unknown): FleetRow {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid device row.')
  const row = value as Record<string, unknown>
  if (
    Object.keys(row).some(
      (k) =>
        ![
          'name',
          'external_id',
          'serial_number',
          'description',
          'metadata',
          'lifecycle',
          'group',
          'tags',
        ].includes(k),
    )
  )
    throw new Error('Unsupported device field. Credentials cannot be imported.')
  const metadata = row.metadata ?? {}
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    new TextEncoder().encode(JSON.stringify(metadata)).length > 4096
  )
    throw new Error('Metadata must be a JSON object of at most 4 KiB.')
  // Metadata is inert JSON, never an expression or property merge into a privileged object.
  if (row.lifecycle && !['enabled', 'disabled'].includes(String(row.lifecycle)))
    throw new Error('Initial status must be enabled or disabled.')
  return {
    name: safeText(row.name, 100, true),
    external_id: safeText(row.external_id, 128),
    serial_number: safeText(row.serial_number, 128),
    description: safeText(row.description, 1000, false, true),
    ...(row.group ? { group: safeText(row.group, 100) } : {}),
    ...(row.tags ? { tags: labels(safeText(row.tags, 1000)).join(',') } : {}),
    metadata: metadata as Record<string, unknown>,
    lifecycle: row.lifecycle === 'disabled' ? 'disabled' : 'enabled',
  }
}
export function quantityRows(
  prefix: string,
  quantity: number,
  start = 1,
  digits = 3,
): FleetRow[] {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 10000 ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > 1e9 ||
    !Number.isInteger(digits) ||
    digits < 1 ||
    digits > 10
  )
    throw new Error('Quantity must be 1–10,000 with valid numbering.')
  return Array.from({ length: quantity }, (_, i) =>
    deviceRow({ name: prefix + String(start + i).padStart(digits, '0') }),
  )
}
// Strict RFC 4180-style CSV: embedded newlines, escaped quotes, CRLF and UTF-8 BOM.
export function parseCsv(input: string): string[][] {
  if (new TextEncoder().encode(input).length > 4 * 1024 * 1024)
    throw new Error('CSV exceeds 4 MiB.')
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false
  const cell = () => {
    if (value.length > 8192 || row.length >= 32)
      throw new Error('CSV field or column limit exceeded.')
    row.push(value)
    value = ''
    closed = false
  }
  const line = () => {
    cell()
    if (row.some((v) => v.length)) rows.push(row)
    row = []
    if (rows.length > 10001)
      throw new Error('CSV has more than 10,000 device rows.')
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else value += c
      continue
    }
    if (c === '"') {
      if (value || closed) throw new Error('Malformed CSV quote.')
      quoted = true
    } else if (c === ',') cell()
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++
      line()
    } else {
      if (closed) throw new Error('Unexpected text after CSV quote.')
      value += c
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote.')
  if (value || row.length || closed) line()
  if (
    !rows.length ||
    rows[0]!.some((v) => !v.trim()) ||
    new Set(rows[0]).size !== rows[0]!.length
  )
    throw new Error('CSV needs unique, nonempty headers.')
  if (rows.some((r) => r.length !== rows[0]!.length))
    throw new Error('CSV rows have inconsistent column counts.')
  return rows
}
export const CSV_FIELDS = [
  'name',
  'external_id',
  'serial_number',
  'description',
  'metadata',
  'lifecycle',
  'group',
  'tags',
] as const
export function csvRows(text: string, mapping: Record<string, string>) {
  const [headers, ...rows] = parseCsv(text)
  const columns = Object.entries(mapping)
  if (
    !columns.some(([, field]) => field === 'name') ||
    columns.some(
      ([header, field]) =>
        !headers!.includes(header) ||
        !CSV_FIELDS.includes(field as (typeof CSV_FIELDS)[number]),
    ) ||
    new Set(columns.map(([, f]) => f)).size !== columns.length
  )
    throw new Error('Map a name column and unique supported fields.')
  return rows.map((values, index) => {
    try {
      const raw = Object.fromEntries(
        columns.map(([h, f]) => [f, values[headers!.indexOf(h)]]),
      )
      if (raw.metadata) raw.metadata = JSON.parse(raw.metadata)
      return { row: index + 2, value: deviceRow(raw), error: null }
    } catch (e) {
      return { row: index + 2, value: null, error: (e as Error).message }
    }
  })
}
export function csvExport(rows: unknown[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let v = cell == null ? '' : String(cell)
          if (/^[\s]*[=+@\-\t\r]/.test(v)) v = "'" + v
          return '"' + v.replaceAll('"', '""') + '"'
        })
        .join(','),
    )
    .join('\r\n')
}

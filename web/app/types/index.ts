export type FieldType = 'float32' | 'int32' | 'uint8' | 'boolean'

export interface SchemaField {
  name: string
  type: FieldType
}

export interface Device {
  id: string
  user_id: string
  name: string
  api_key: string
  last_seen: string | null
  created_at: string
}

export interface DeviceSchema {
  id: string
  device_id: string
  schema_definition: SchemaField[]
  updated_at: string
}

export interface TelemetryRow {
  id: string
  device_id: string
  parsed_json: Record<string, number | boolean>
  timestamp: string
}

export const FIELD_TYPES: FieldType[] = ['float32', 'int32', 'uint8', 'boolean']

export const TYPE_SIZES: Record<FieldType, number> = {
  float32: 4,
  int32: 4,
  uint8: 1,
  boolean: 1,
}

export function isDeviceOnline(lastSeen: string | null, windowMs = 30_000): boolean {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < windowMs
}

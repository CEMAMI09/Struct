export type ScalarFieldType = 'float32' | 'int32' | 'uint8' | 'boolean'
export type FieldType = ScalarFieldType | 'flags' | 'char'

export interface FlagBit {
  name: string
  /** Bit position 0–7 within the packed byte */
  bit: number
}

export type OrgRole = 'owner' | 'admin' | 'viewer'
export type SubscriptionTier = 'free' | 'flexible' | 'pro' | 'scale'

export interface Organization {
  id: string
  name: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_item_id: string | null
  stripe_quantity: number
  subscription_tier: SubscriptionTier
  created_at: string
}

export interface OrganizationMember {
  id: string
  organization_id: string
  user_id: string
  role: OrgRole
  created_at: string
}

export interface ScalarSchemaField {
  name: string
  type: ScalarFieldType
}

export interface FlagsSchemaField {
  name: string
  type: 'flags'
  bits: FlagBit[]
}

/** Packed C `char name[length]` / byte array (e.g. device_id[6]). */
export interface CharArraySchemaField {
  name: string
  type: 'char'
  /** Number of bytes in the array (1–64). */
  length: number
}

export type SchemaField = ScalarSchemaField | FlagsSchemaField | CharArraySchemaField

/** Fleet tags: Location → Chicago_Factory, Version → v1.0.4, etc. */
export type DeviceTags = Record<string, string>

export interface DeviceProfile {
  id: string
  organization_id: string
  user_id: string
  name: string
  device_model: string
  firmware_version: string
  schema_definition: SchemaField[]
  identity_field: string
  fleet_key_id: string
  fleet_secret_preview: string | null
  created_at: string
  updated_at: string
}

export interface DeviceProfileCredentials {
  fleetKeyId: string
  fleetSecret: string
}

export interface Device {
  id: string
  user_id: string
  organization_id: string
  name: string
  api_key: string
  key_id: string
  api_secret_preview: string | null
  protocol_version: number
  mac_address: string | null
  last_seen: string | null
  created_at: string
  tags: DeviceTags
  encryption_enabled: boolean
  encryption_key: string | null
  profile_id: string | null
  hardware_id: string | null
}

export interface DeviceCredentials {
  keyId: string
  apiSecret: string
}

export interface BulkDeviceInput {
  name: string
  mac_address: string
  tags: DeviceTags
}

export interface ProfileBulkDeviceInput {
  name: string
  hardware_id: string
  mac_address?: string | null
  tags: DeviceTags
}

export interface BulkUploadQuote {
  importId: string
  expiresAt: string
  deviceCount: number
  currentDeviceCount: number
  projectedDeviceCount: number
  previousPeakPaidQuantity: number
  projectedPeakPaidQuantity: number
  quantityDelta: number
  estimatedTrueUpAmount: number
  currency: string
  estimatedTrueUpFormatted: string
  needsUsageUpdate: boolean
  disclaimer: string
}

export interface DeviceSchema {
  id: string
  device_id: string
  organization_id: string
  schema_definition: SchemaField[]
  /** Latest published wire version (1–255) */
  version: number
  updated_at: string
}

/** Immutable historical layout kept so older fleets keep parsing */
export interface SchemaVersion {
  id: string
  device_id: string
  version: number
  schema_definition: SchemaField[]
  created_at: string
}

export type TelemetryValue = number | boolean | string | Record<string, boolean>

export interface TelemetryRow {
  id: string
  device_id: string
  parsed_json: Record<string, TelemetryValue>
  timestamp: string
}

export type RoutingOperator = '>' | '>=' | '<' | '<=' | '==' | '!='

export interface RoutingRule {
  key: string
  operator: RoutingOperator
  value: string | number | boolean
}

export interface Destination {
  id: string
  user_id: string
  organization_id: string
  name: string
  url: string
  device_id: string | null
  routing_rule: RoutingRule | null
  event_types: WebhookEventType[]
  signing_secret: string
  enabled: boolean
  created_at: string
}

export type WebhookEventType =
  | 'telemetry.received'
  | 'device.connected'
  | 'device.disconnected'

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE'

export interface AuditLog {
  id: string
  organization_id: string
  user_id: string | null
  action: AuditAction
  table_name: 'devices' | 'schemas' | 'destinations'
  record_id: string
  previous_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

export type CommandStatus = 'pending' | 'claimed' | 'sent' | 'acknowledged' | 'delivered' | 'failed'

export interface PendingCommand {
  id: string
  device_id: string
  user_id: string
  command_type: string
  payload: Record<string, unknown>
  packed_hex: string
  command_id: string
  status: CommandStatus
  created_at: string
  delivered_at: string | null
  sent_at: string | null
  acknowledged_at: string | null
}

export const FIELD_TYPES: FieldType[] = ['float32', 'int32', 'uint8', 'boolean', 'flags', 'char']

export const TYPE_SIZES: Record<Exclude<FieldType, 'char'>, number> = {
  float32: 4,
  int32: 4,
  uint8: 1,
  boolean: 1,
  flags: 1,
}

export function fieldByteLength(field: SchemaField): number {
  if (field.type === 'flags') return 1
  if (field.type === 'char') {
    const len = Number(field.length)
    if (!Number.isInteger(len) || len < 1 || len > 64) {
      throw new Error(`char field "${field.name}" length must be 1..64`)
    }
    return len
  }
  return TYPE_SIZES[field.type]
}

export function isFlagsField(field: SchemaField): field is FlagsSchemaField {
  return field.type === 'flags'
}

export function isCharField(field: SchemaField): field is CharArraySchemaField {
  return field.type === 'char'
}

export function isDeviceOnline(lastSeen: string | null, windowMs = 30_000): boolean {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < windowMs
}

export function tagsToPairs(tags: DeviceTags | null | undefined): { key: string; value: string }[] {
  if (!tags) return []
  return Object.entries(tags).map(([key, value]) => ({ key, value }))
}

export function pairsToTags(pairs: { key: string; value: string }[]): DeviceTags {
  const out: DeviceTags = {}
  for (const { key, value } of pairs) {
    const k = key.trim()
    if (!k) continue
    out[k] = value.trim()
  }
  return out
}

export type FieldType = 'float32' | 'int32' | 'uint8' | 'boolean'

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

export interface SchemaField {
  name: string
  type: FieldType
}

/** Fleet tags: Location → Chicago_Factory, Version → v1.0.4, etc. */
export type DeviceTags = Record<string, string>

export interface Device {
  id: string
  user_id: string
  organization_id: string
  name: string
  api_key: string
  mac_address: string | null
  last_seen: string | null
  created_at: string
  tags: DeviceTags
  encryption_enabled: boolean
  encryption_key: string | null
}

export interface BulkDeviceInput {
  name: string
  mac_address: string
  tags: DeviceTags
}

export interface BulkUploadQuote {
  importId: string
  expiresAt: string
  deviceCount: number
  currentDeviceCount: number
  projectedDeviceCount: number
  previousStripeQuantity: number
  targetStripeQuantity: number
  quantityDelta: number
  estimatedProrationAmount: number
  currency: string
  estimatedProrationFormatted: string
  needsStripeUpdate: boolean
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

export interface TelemetryRow {
  id: string
  device_id: string
  parsed_json: Record<string, number | boolean>
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

export type CommandStatus = 'pending' | 'delivered' | 'failed'

export interface PendingCommand {
  id: string
  device_id: string
  user_id: string
  command_type: string
  payload: Record<string, unknown>
  packed_hex: string
  status: CommandStatus
  created_at: string
  delivered_at: string | null
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

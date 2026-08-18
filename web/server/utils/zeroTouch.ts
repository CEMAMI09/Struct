import { fieldByteLength, type SchemaField } from '../../app/types'
import { createDeviceCredentials, sanitizeDeviceForClient } from './deviceCredentials'

/**
 * Decode a packed char[N] / opaque identity into a canonical hardware id.
 * Printable ASCII → trimmed string; otherwise lowercase hex of the raw bytes.
 */
export function hardwareIdFromIdentityValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) return null
    const cleaned = trimmed.replace(/[^0-9a-z]/g, '')
    return cleaned.length >= 2 && cleaned.length <= 64 ? cleaned : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  return null
}

export function assertIdentityFieldInSchema(
  schemaDefinition: SchemaField[],
  identityField: string,
) {
  const field = schemaDefinition.find((f) => f.name === identityField)
  if (!field) {
    throw createError({
      statusCode: 400,
      message: `identity_field "${identityField}" missing from profile schema`,
    })
  }
  return field
}

export function estimateStructLength(schemaDefinition: SchemaField[]) {
  return schemaDefinition.reduce((sum, f) => sum + fieldByteLength(f), 0)
}

/**
 * Find-or-create a device under a profile using the atomic Postgres RPC.
 * Returns whether the device was newly registered.
 */
export async function zeroTouchRegisterDevice(
  supabase: any,
  profile: {
    id: string
    organization_id: string
    name: string
    schema_definition: SchemaField[]
  },
  hardwareId: string,
  opts?: { name?: string },
) {
  const { data: existing } = await supabase
    .from('devices')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('profile_id', profile.id)
    .eq('hardware_id', hardwareId)
    .maybeSingle()

  if (existing) {
    return { device: sanitizeDeviceForClient(existing), created: false }
  }

  const creds = createDeviceCredentials()
  const { data: device, error } = await supabase.rpc('zero_touch_register_device', {
    p_profile_id: profile.id,
    p_hardware_id: hardwareId,
    p_name: opts?.name || null,
    p_key_id: creds.keyId,
    p_api_secret_encrypted: creds.apiSecretEncrypted,
    p_api_secret_preview: creds.apiSecretPreview,
  })

  if (error) {
    if (/PROFILE_NOT_FOUND/i.test(error.message)) {
      throw createError({ statusCode: 404, message: 'Device profile not found' })
    }
    throw createError({ statusCode: 500, message: error.message })
  }

  const row = Array.isArray(device) ? device[0] : device
  if (!row) {
    throw createError({ statusCode: 500, message: 'Zero-touch registration returned no device' })
  }

  return {
    device: sanitizeDeviceForClient(row),
    created: row.key_id === creds.keyId,
  }
}

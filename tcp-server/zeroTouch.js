/**
 * Zero-touch provisioning for Master Fleet Key authenticated frames.
 * Used by the TCP/UDP gateway when key_id matches a device_profiles.fleet_key_id.
 */
const crypto = require('crypto')
const { parsePayload, schemaByteLength } = require('./parser-native')
const { decryptSecret, encryptSecret } = require('./auth')

function randomKeyId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(16)
  let key = ''
  for (let i = 0; i < 16; i++) {
    key += alphabet[bytes[i] % alphabet.length]
  }
  return key
}

function randomApiSecret() {
  return crypto.randomBytes(32).toString('hex')
}

function secretPreview(secret) {
  return secret.length > 4 ? secret.slice(-4) : secret
}

function hardwareIdFromIdentityValue(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase().replace(/[^0-9a-z]/g, '')
    return cleaned.length >= 2 && cleaned.length <= 64 ? cleaned : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  return null
}

async function lookupProfileByFleetKeyId(supabase, fleetKeyId) {
  const { data: profile, error } = await supabase
    .from('device_profiles')
    .select(
      'id, organization_id, user_id, name, device_model, firmware_version, schema_definition, identity_field, fleet_key_id, fleet_secret_encrypted',
    )
    .eq('fleet_key_id', fleetKeyId)
    .maybeSingle()

  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  return profile
}

function getProfileSecret(profile, secretCache) {
  const cacheKey = `profile:${profile.id}`
  const cached = secretCache.get(cacheKey)
  if (cached) return cached
  if (!profile.fleet_secret_encrypted) {
    throw new Error(`Profile "${profile.name}" is missing fleet credentials`)
  }
  const secret = decryptSecret(profile.fleet_secret_encrypted)
  secretCache.set(cacheKey, secret)
  return secret
}

/**
 * Parse a plaintext packed struct with the profile schema, extract identity,
 * and find-or-create the device row.
 *
 * @returns {{ device: object, created: boolean, parsed: object, hardwareId: string, profile: object }}
 */
async function resolveDeviceFromFleetPayload(supabase, profile, structBuf) {
  const schemaDef = Array.isArray(profile.schema_definition)
    ? profile.schema_definition
    : []
  if (!schemaDef.length) {
    throw new Error(`Profile "${profile.name}" has an empty schema`)
  }

  const identityField = String(profile.identity_field || 'device_id')
  if (!schemaDef.some((f) => f.name === identityField)) {
    throw new Error(
      `Profile "${profile.name}" identity_field "${identityField}" missing from schema`,
    )
  }

  const expected = schemaByteLength(schemaDef)
  if (structBuf.length < expected) {
    throw new Error(
      `Fleet payload underrun for profile "${profile.name}": got ${structBuf.length}B, need ${expected}`,
    )
  }

  const parsed = parsePayload(structBuf.subarray(0, expected), schemaDef)
  const hardwareId = hardwareIdFromIdentityValue(parsed[identityField])
  if (!hardwareId) {
    throw new Error(
      `Could not extract identity from field "${identityField}" on profile "${profile.name}"`,
    )
  }

  const keyId = randomKeyId()
  const apiSecret = randomApiSecret()

  const { data: device, error } = await supabase.rpc('zero_touch_register_device', {
    p_profile_id: profile.id,
    p_hardware_id: hardwareId,
    p_name: null,
    p_key_id: keyId,
    p_api_secret_encrypted: encryptSecret(apiSecret),
    p_api_secret_preview: secretPreview(apiSecret),
  })

  if (error) {
    throw new Error(`Zero-touch registration failed: ${error.message}`)
  }

  const row = Array.isArray(device) ? device[0] : device
  if (!row) {
    throw new Error('Zero-touch registration returned no device')
  }

  const created = row.key_id === keyId
  if (created) {
    console.log(
      `[struct] zero-touch registered ${row.name} (${hardwareId}) under profile ${profile.name}`,
    )
  }

  // Attach schema relation shape expected by ingestTelemetryFrame resolvers.
  const hydrated = {
    ...row,
    schemas: {
      version: 1,
      schema_definition: schemaDef,
    },
    encryption_enabled: !!row.encryption_enabled,
    encryption_key: row.encryption_key || null,
  }

  return {
    device: hydrated,
    created,
    parsed,
    hardwareId,
    profile,
    schemaDef,
  }
}

module.exports = {
  lookupProfileByFleetKeyId,
  getProfileSecret,
  resolveDeviceFromFleetPayload,
  hardwareIdFromIdentityValue,
}

import crypto from 'node:crypto'
import {ingestEndpoint} from './ingestEndpoint'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serverSupabaseClient } from '#supabase/server'
import { requireOrgWriter } from './auth'
import { decryptApiSecret, encryptApiSecret } from './deviceCredentials'
import { slotRecordBytes, type SecureV2Encoding, type SecureV2Slot } from '#shared/secureV2Schema'

export function secureV2Available() {
  const value = useRuntimeConfig().secureV2Enabled
  return value === true || String(value) === 'true'
}

export function requireSecureV2Available() {
  if (!secureV2Available()) throw createError({ statusCode: 503, message: 'Secure V2 is not enabled on this deployment yet.' })
}

export function noStoreSecureV2(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Pragma', 'no-cache')
}

export async function authorizeSecureV2Device(event: H3Event, service: SupabaseClient, deviceId: string, orgId: string, write = true) {
  if (!deviceId || !orgId) throw createError({ statusCode: 400, message: 'Device and organization are required.' })
  if (write) await requireOrgWriter(event, orgId, 'devices.provision')
  else {
    const client = await serverSupabaseClient(event)
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) throw createError({ statusCode: 401, message: 'Not authenticated' })
    const { data: membership } = await client.from('organization_members').select('role')
      .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle()
    if (!membership) throw createError({ statusCode: 403, message: 'Not authorized' })
  }
  const { data, error } = await service.from('devices').select('id,name,organization_id')
    .eq('id', deviceId).eq('organization_id', orgId).maybeSingle()
  if (error) throw createError({ statusCode: 500, message: 'Device lookup failed.' })
  if (!data) throw createError({ statusCode: 404, message: 'Device not found.' })
  return data
}

export function createSecureV2Credential() {
  const rootSecret = crypto.randomBytes(32).toString('hex')
  const bootstrapToken = crypto.randomBytes(32).toString('hex')
  return {
    rootSecret, bootstrapToken,
    rootEncrypted: encryptApiSecret(rootSecret),
    bootstrapEncrypted: encryptApiSecret(bootstrapToken),
    bootstrapHash: crypto.createHash('sha256').update(Buffer.from(bootstrapToken, 'hex')).digest(),
    preview: rootSecret.slice(-4),
  }
}

export function validateSecureV2Slot(body: Record<string, unknown>) {
  const slot = body.slot
  const encoding = body.encoding
  const definition = body.schemaDefinition
  const interval = body.sampleIntervalMs ?? null
  const version = body.legacySchemaVersion ?? null
  if (!Number.isInteger(slot) || Number(slot) < 0 || Number(slot) > 15
    || !['legacy-le-v1', 'bitpacked-v1'].includes(String(encoding))) {
    throw createError({ statusCode: 400, message: 'Choose a schema slot 0..15 and a supported encoding.' })
  }
  if ((interval !== null && (!Number.isInteger(interval) || Number(interval) < 1 || Number(interval) > 604800000))
    || (version !== null && (encoding !== 'legacy-le-v1' || !Number.isInteger(version) || Number(version) < 1 || Number(version) > 255))) {
    throw createError({ statusCode: 400, message: 'Invalid schema version or sample interval.' })
  }
  if (!Array.isArray(definition) || definition.length > 128) throw createError({ statusCode: 400, message: 'Schema must contain 1..128 fields.' })
  let bytes: number
  try {
    bytes = slotRecordBytes(definition, encoding as SecureV2Encoding)
  } catch (error) {
    throw createError({ statusCode: 400, message: (error as Error).message || 'Invalid schema.' })
  }
  if (bytes < 1 || bytes > 1175) throw createError({ statusCode: 400, message: 'Schema exceeds the Secure V2 datagram limit.' })
  return { slot: Number(slot), encoding: encoding as SecureV2Encoding, definition, bytes,
    legacySchemaVersion: version === null ? null : Number(version), sampleIntervalMs: interval === null ? null : Number(interval) }
}

export async function getSecureV2Metadata(service: SupabaseClient, deviceId: string) {
  const { data: device, error } = await service.from('devices').select('secure_v2_enabled,wire_device_id')
    .eq('id', deviceId).single()
  if (error) throw createError({ statusCode: 500, message: 'Secure V2 configuration lookup failed.' })
  const { data: slots, error: slotsError } = await service.from('secure_v2_schema_slots').select('*')
    .eq('device_id', deviceId).order('slot')
  if (slotsError) throw createError({ statusCode: 500, message: 'Secure V2 schema lookup failed.' })
  let secretPreview: string | null = null
  if (device.wire_device_id) {
    const { data: credential, error: credentialError } = await service.from('secure_v2_credentials')
      .select('secret_preview').eq('wire_device_id', device.wire_device_id).maybeSingle()
    if (credentialError) throw createError({ statusCode: 500, message: 'Secure V2 credential lookup failed.' })
    secretPreview = credential?.secret_preview || null
  }
  return { available: true, enabled: device.secure_v2_enabled, wireDeviceId: device.wire_device_id ? Number(device.wire_device_id) : null,
    secretPreview, ...(process.env.STRUCT_INGEST_HOST||process.env.STRUCT_INGEST_PORT||process.env.STRUCT_BOOTSTRAP_ORIGIN?{endpoint:ingestEndpoint()}:{}), slots: (slots || []) as SecureV2Slot[] }
}

export function exportSecureV2Credential(row: { wire_device_id: number | string; root_secret_encrypted: string; bootstrap_token_encrypted: string }) {
  const rootSecret = decryptApiSecret(row.root_secret_encrypted)
  const bootstrapToken = decryptApiSecret(row.bootstrap_token_encrypted)
  if (!/^[a-f0-9]{64}$/.test(rootSecret) || !/^[a-f0-9]{64}$/.test(bootstrapToken)) {
    throw createError({ statusCode: 500, message: 'Secure V2 credentials need rotation.' })
  }
  return { wireDeviceId: Number(row.wire_device_id), rootSecret, bootstrapToken }
}

/**
 * Zero-touch provisioning API.
 *
 * Gateway / factory path: authenticate with Master Fleet Key, parse the packed
 * struct using the Device Profile schema, extract `device_id` (identity field),
 * and auto-register the unit in Postgres if it does not already exist.
 *
 * Body (application/json):
 * {
 *   fleetKeyId: string,          // Master Fleet Key (Protocol v2 key_id)
 *   fleetSecret?: string,        // plaintext secret — or Authorization header
 *   payloadBase64: string,       // raw packed struct bytes (post Protocol unwrap)
 *   schemaVersion?: number,      // currently informational (profiles are v1)
 *   deviceName?: string          // optional override for first registration
 * }
 *
 * Auth alternatives:
 * - Body.fleetSecret
 * - Header Authorization: Bearer <fleetSecret>
 * - Header x-struct-fleet-secret: <fleetSecret>
 */
import { serverSupabaseServiceRole } from '#supabase/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { parsePackedPayload } from '../../utils/binaryParser'
import { decryptApiSecret } from '../../utils/deviceCredentials'
import {
  assertIdentityFieldInSchema,
  estimateStructLength,
  hardwareIdFromIdentityValue,
  zeroTouchRegisterDevice,
} from '../../utils/zeroTouch'
import type { SchemaField } from '../../../app/types'

function secretsEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function readFleetSecret(event: any, body: { fleetSecret?: string }) {
  const headerBearer = getHeader(event, 'authorization')
  const bearer =
    headerBearer && /^Bearer\s+/i.test(headerBearer)
      ? headerBearer.replace(/^Bearer\s+/i, '').trim()
      : ''
  const headerSecret = getHeader(event, 'x-struct-fleet-secret')?.trim() || ''
  return (body.fleetSecret || bearer || headerSecret || '').trim()
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    fleetKeyId?: string
    fleetSecret?: string
    payloadBase64?: string
    schemaVersion?: number
    deviceName?: string
  }>(event)

  const fleetKeyId = body?.fleetKeyId?.trim()
  const payloadBase64 = body?.payloadBase64?.trim()
  const providedSecret = readFleetSecret(event, body || {})

  if (!fleetKeyId || !payloadBase64) {
    throw createError({
      statusCode: 400,
      message: 'fleetKeyId and payloadBase64 are required',
    })
  }
  if (!providedSecret) {
    throw createError({
      statusCode: 401,
      message: 'Fleet secret required (body.fleetSecret or Authorization Bearer)',
    })
  }

  let payload: Buffer
  try {
    payload = Buffer.from(payloadBase64, 'base64')
  } catch {
    throw createError({ statusCode: 400, message: 'payloadBase64 is invalid' })
  }
  if (!payload.length) {
    throw createError({ statusCode: 400, message: 'payload is empty' })
  }

  const supabase = await serverSupabaseServiceRole(event)

  const { data: profile, error: profileError } = await supabase
    .from('device_profiles')
    .select(
      'id, organization_id, user_id, name, device_model, firmware_version, schema_definition, identity_field, fleet_key_id, fleet_secret_encrypted',
    )
    .eq('fleet_key_id', fleetKeyId)
    .maybeSingle()

  if (profileError) {
    throw createError({ statusCode: 500, message: profileError.message })
  }
  if (!profile) {
    throw createError({ statusCode: 401, message: 'Unrecognized Master Fleet Key' })
  }

  let storedSecret: string
  try {
    storedSecret = decryptApiSecret(profile.fleet_secret_encrypted)
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      message: e?.message || 'Failed to decrypt fleet secret',
    })
  }

  if (!secretsEqual(providedSecret, storedSecret)) {
    createHmac('sha256', storedSecret).update(fleetKeyId).digest()
    throw createError({ statusCode: 401, message: 'Invalid fleet secret' })
  }

  const schemaDefinition = (
    Array.isArray(profile.schema_definition) ? profile.schema_definition : []
  ) as SchemaField[]

  if (!schemaDefinition.length) {
    throw createError({ statusCode: 400, message: 'Profile has an empty schema' })
  }

  const identityField = String(profile.identity_field || 'device_id')
  assertIdentityFieldInSchema(schemaDefinition, identityField)

  const expected = estimateStructLength(schemaDefinition)
  if (payload.length < expected) {
    throw createError({
      statusCode: 400,
      message: `Payload underrun: got ${payload.length}B, schema needs ${expected}B`,
    })
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parsePackedPayload(payload.subarray(0, expected), schemaDefinition)
  } catch (e: any) {
    throw createError({
      statusCode: 400,
      message: e?.message || 'Failed to parse packed payload',
    })
  }

  const hardwareId = hardwareIdFromIdentityValue(parsed[identityField])
  if (!hardwareId) {
    throw createError({
      statusCode: 400,
      message: `Could not extract identity from field "${identityField}"`,
    })
  }

  const { device, created } = await zeroTouchRegisterDevice(
    supabase,
    {
      id: profile.id,
      organization_id: profile.organization_id,
      name: profile.name,
      schema_definition: schemaDefinition,
    },
    hardwareId,
    { name: body.deviceName?.trim() || undefined },
  )

  return {
    registered: true,
    created,
    hardwareId,
    identityField,
    profileId: profile.id,
    organizationId: profile.organization_id,
    device,
    parsed,
  }
})

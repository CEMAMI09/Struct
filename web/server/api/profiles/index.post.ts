import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import {
  createDeviceCredentials,
  sanitizeDeviceForClient,
} from '../../utils/deviceCredentials'
import { validateProfileSchema } from '../../utils/profileSchema'
import { asDatabaseJson } from '../../utils/databaseJson'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = await readBody<{
    orgId?: string
    name?: string
    deviceModel?: string
    firmwareVersion?: string
    schemaDefinition?: unknown
    identityField?: string
  }>(event)

  const orgId = body?.orgId?.trim()
  const name = body?.name?.trim()
  const deviceModel = body?.deviceModel?.trim() || ''
  const firmwareVersion = body?.firmwareVersion?.trim() || ''
  const identityField = body?.identityField?.trim() || 'device_id'

  if (!orgId || !name) {
    throw createError({
      statusCode: 400,
      message: 'orgId and name are required',
    })
  }

  const schemaDefinition = validateProfileSchema(
    body?.schemaDefinition,
    identityField,
  )
  const { user, requestId } = await requireOrgWriter(
    event,
    orgId,
    'devices.export_credentials',
  )
  const supabase = await serverSupabaseServiceRole(event)
  const creds = createDeviceCredentials()

  const { data: profile, error } = await (supabase as any).rpc(
    'enterprise_legacy_admin',
    {
      p_org: orgId,
      p_actor: user.id,
      p_action: 'profile',
      p_device: null,
      p_request: requestId,
      p_data: {
        name,
        device_model: deviceModel,
        firmware_version: firmwareVersion,
        schema_definition: asDatabaseJson(schemaDefinition),
        identity_field: identityField,
        key_id: creds.keyId,
        secret_encrypted: creds.apiSecretEncrypted,
        secret_preview: creds.apiSecretPreview,
      },
    },
  )

  if (error) {
    if (/unique|duplicate/i.test(error.message)) {
      throw createError({
        statusCode: 409,
        message: 'A profile with this name already exists in the organization',
      })
    }
    throw createError({ statusCode: 500, message: error.message })
  }

  return {
    profile: sanitizeDeviceForClient(profile),
    credentials: {
      fleetKeyId: creds.keyId,
      fleetSecret: creds.apiSecret,
    },
  }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import { createDeviceCredentials, sanitizeDeviceForClient } from '../../utils/deviceCredentials'
import { validateProfileSchema } from '../../utils/profileSchema'

export default defineEventHandler(async (event) => {
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
    throw createError({ statusCode: 400, message: 'orgId and name are required' })
  }

  const schemaDefinition = validateProfileSchema(body?.schemaDefinition, identityField)
  const { user } = await requireOrgWriter(event, orgId)
  const supabase = await serverSupabaseServiceRole(event)
  const creds = createDeviceCredentials()

  const { data: profile, error } = await supabase
    .from('device_profiles')
    .insert({
      organization_id: orgId,
      user_id: user.id,
      name,
      device_model: deviceModel,
      firmware_version: firmwareVersion,
      schema_definition: schemaDefinition,
      identity_field: identityField,
      fleet_key_id: creds.keyId,
      fleet_secret_encrypted: creds.apiSecretEncrypted,
      fleet_secret_preview: creds.apiSecretPreview,
    })
    .select(
      'id, organization_id, user_id, name, device_model, firmware_version, schema_definition, identity_field, fleet_key_id, fleet_secret_preview, created_at, updated_at',
    )
    .single()

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

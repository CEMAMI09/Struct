import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import {
  createDeviceCredentials,
  sanitizeDeviceForClient,
} from '../../utils/deviceCredentials'
import { recordCapacityUsage, resolveCapacityPlan } from '../../utils/deviceCapacity'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    name?: string
    orgId?: string
    macAddress?: string
  }>(event)
  const name = body?.name?.trim()
  const orgId = body?.orgId?.trim()
  const macAddress = body?.macAddress?.trim() || null

  if (!name || !orgId) {
    throw createError({ statusCode: 400, message: 'name and orgId are required' })
  }

  const { user } = await requireOrgWriter(event, orgId)
  const serviceSupabase = await serverSupabaseServiceRole(event)

  const plan = await resolveCapacityPlan(serviceSupabase, orgId, 1)
  const creds = createDeviceCredentials()

  const { data: device, error: deviceError } = await serviceSupabase
    .from('devices')
    .insert({
      name,
      api_key: creds.keyId,
      key_id: creds.keyId,
      api_secret_encrypted: creds.apiSecretEncrypted,
      api_secret_preview: creds.apiSecretPreview,
      protocol_version: 2,
      user_id: user.id,
      organization_id: orgId,
      tags: {},
      encryption_enabled: false,
      mac_address: macAddress,
    })
    .select()
    .single()

  if (deviceError) {
    throw createError({ statusCode: 500, message: deviceError.message })
  }

  const { error: schemaError } = await serviceSupabase.from('schemas').insert({
    device_id: device.id,
    organization_id: orgId,
    schema_definition: [],
    version: 1,
  })

  if (schemaError) {
    await serviceSupabase.from('devices').delete().eq('id', device.id)
    throw createError({ statusCode: 500, message: schemaError.message })
  }

  const { error: versionError } = await serviceSupabase.from('schema_versions').insert({
    device_id: device.id,
    version: 1,
    schema_definition: [],
  })

  if (versionError) {
    await serviceSupabase.from('devices').delete().eq('id', device.id)
    throw createError({ statusCode: 500, message: versionError.message })
  }

  await recordCapacityUsage(serviceSupabase, orgId, plan.projectedCount)

  return {
    device: sanitizeDeviceForClient(device),
    credentials: {
      keyId: creds.keyId,
      apiSecret: creds.apiSecret,
    },
  }
})

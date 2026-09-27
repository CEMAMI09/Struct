import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import {
  createDeviceCredentials,
  sanitizeDeviceForClient,
} from '../../utils/deviceCredentials'
import { resolveCapacityPlan } from '../../utils/deviceCapacity'

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

  // The database creates the device, initial schemas, and usage peak in one
  // transaction. A failed usage update must not strand a one-time secret.
  const { data: device, error: deviceError } = await serviceSupabase.rpc(
    'create_device_with_usage',
    {
      p_org_id: orgId,
      p_user_id: user.id,
      p_name: name,
      p_key_id: creds.keyId,
      p_api_secret_encrypted: creds.apiSecretEncrypted,
      p_api_secret_preview: creds.apiSecretPreview,
      p_mac_address: macAddress ?? '',
      p_expected_current_count: plan.currentCount,
    },
  )

  if (deviceError) {
    if (deviceError.message.includes('DEVICE_COUNT_CHANGED')) {
      throw createError({ statusCode: 409, message: 'Fleet size changed. Refresh and try again.' })
    }
    throw createError({ statusCode: 500, message: deviceError.message })
  }

  if (!device) throw createError({ statusCode: 500, message: 'Device creation returned no row' })

  return {
    device: sanitizeDeviceForClient(device),
    credentials: {
      keyId: creds.keyId,
      apiSecret: creds.apiSecret,
    },
  }
})

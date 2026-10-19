import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../../utils/auth'
import {
  createDeviceCredentials,
  sanitizeDeviceForClient,
} from '../../../utils/deviceCredentials'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const deviceId = getRouterParam(event, 'id')?.trim()
  const body = await readBody<{ orgId?: string }>(event)
  const orgId = body?.orgId?.trim()

  if (!deviceId || !orgId) {
    throw createError({
      statusCode: 400,
      message: 'device id and orgId are required',
    })
  }

  const { user, requestId } = await requireOrgWriter(
    event,
    orgId,
    'devices.provision',
  )
  const supabase = await serverSupabaseServiceRole(event)
  const creds = createDeviceCredentials()

  const { data, error } = await (supabase as any).rpc(
    'enterprise_legacy_admin',
    {
      p_org: orgId,
      p_actor: user.id,
      p_action: 'legacy_key',
      p_device: deviceId,
      p_request: requestId,
      p_data: {
        key_id: creds.keyId,
        secret_encrypted: creds.apiSecretEncrypted,
        secret_preview: creds.apiSecretPreview,
      },
    },
  )

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
  if (!data) {
    throw createError({ statusCode: 404, message: 'Device not found' })
  }

  return {
    device: sanitizeDeviceForClient(data),
    credentials: {
      keyId: creds.keyId,
      apiSecret: creds.apiSecret,
    },
  }
})

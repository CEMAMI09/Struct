import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const deviceId = getRouterParam(event, 'id')?.trim()
  const query = getQuery(event)
  const orgId = String(query.orgId || '').trim()

  if (!deviceId || !orgId) {
    throw createError({
      statusCode: 400,
      message: 'device id and orgId are required',
    })
  }

  if (process.env.STRUCT_FLEET_ENABLED === 'true')
    throw createError({
      statusCode: 409,
      message:
        'Use the confirmed Fleet Archive action to preserve telemetry and delivery history.',
    })
  const { user, requestId } = await requireOrgWriter(
    event,
    orgId,
    'devices.delete',
  )
  const serviceSupabase = await serverSupabaseServiceRole(event)

  const { error } = await (serviceSupabase as any).rpc(
    'enterprise_legacy_admin',
    {
      p_org: orgId,
      p_actor: user.id,
      p_action: 'delete',
      p_device: deviceId,
      p_request: requestId,
      p_data: {},
    },
  )
  if (error)
    throw createError({
      statusCode: error.message.includes('USE_FLEET_ARCHIVE')
        ? 409
        : error.message.includes('PERMISSION_DENIED')
          ? 403
          : 404,
      message: error.message.includes('USE_FLEET_ARCHIVE')
        ? 'Archive this device using Fleet Management to preserve telemetry and delivery history.'
        : 'Device deletion unavailable.',
    })

  return { ok: true }
})

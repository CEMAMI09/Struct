import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const deviceId = getRouterParam(event, 'id')?.trim()
  const query = getQuery(event)
  const orgId = String(query.orgId || '').trim()

  if (!deviceId || !orgId) {
    throw createError({ statusCode: 400, message: 'device id and orgId are required' })
  }

  await requireOrgWriter(event, orgId)
  const serviceSupabase = await serverSupabaseServiceRole(event)

  const { data: device, error: lookupError } = await serviceSupabase
    .from('devices')
    .select('id, organization_id')
    .eq('id', deviceId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (lookupError) {
    throw createError({ statusCode: 500, message: lookupError.message })
  }
  if (!device) {
    throw createError({ statusCode: 404, message: 'Device not found' })
  }

  const { error: deleteError } = await serviceSupabase
    .from('devices')
    .delete()
    .eq('id', deviceId)
    .eq('organization_id', orgId)

  if (deleteError) {
    throw createError({ statusCode: 500, message: deleteError.message })
  }

  return { ok: true }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../../utils/auth'
import { randomApiKey } from '../../../utils/bulkDevices'

export default defineEventHandler(async (event) => {
  const deviceId = getRouterParam(event, 'id')?.trim()
  const body = await readBody<{ orgId?: string }>(event)
  const orgId = body?.orgId?.trim()

  if (!deviceId || !orgId) {
    throw createError({ statusCode: 400, message: 'device id and orgId are required' })
  }

  await requireOrgWriter(event, orgId)
  const supabase = await serverSupabaseServiceRole(event)
  const nextKey = randomApiKey()

  const { data, error } = await supabase
    .from('devices')
    .update({ api_key: nextKey })
    .eq('id', deviceId)
    .eq('organization_id', orgId)
    .select()
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
  if (!data) {
    throw createError({ statusCode: 404, message: 'Device not found' })
  }

  return { device: data }
})

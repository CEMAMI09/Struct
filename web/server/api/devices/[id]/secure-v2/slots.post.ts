import { serverSupabaseServiceRole } from '#supabase/server'
import {requireOrgWriter} from '../../../../utils/auth'
import { authorizeSecureV2Device, noStoreSecureV2, requireSecureV2Available, validateSecureV2Slot } from '../../../../utils/secureV2'

export default defineEventHandler(async (event) => {
  noStoreSecureV2(event)
  requireSecureV2Available()
  const deviceId = getRouterParam(event, 'id')?.trim() || ''
  const body = await readBody<Record<string, unknown>>(event)
  const orgId = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
  const slot = validateSecureV2Slot(body || {})
  const service = await serverSupabaseServiceRole(event)
  await authorizeSecureV2Device(event, service, deviceId, orgId)
  const {user,requestId}=await requireOrgWriter(event,orgId,'schemas.update')
  const {data,error}=await (service as any).rpc('enterprise_device_admin',{p_org:orgId,p_actor:user.id,p_action:'slot',p_device:deviceId,p_request:requestId,p_data:slot})
  if (error) throw createError({ statusCode: 409, message: error.message.includes('ALREADY_ASSIGNED')
    ? 'This schema slot is already assigned. Publish into an unused slot.' : 'Schema slot publication failed. Refresh and check the schema version.' })
  return data
})

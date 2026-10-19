import { serverSupabaseServiceRole } from '#supabase/server'
import {requireOrgWriter} from '../../../../utils/auth'
import { authorizeSecureV2Device, exportSecureV2Credential, getSecureV2Metadata, noStoreSecureV2, requireSecureV2Available } from '../../../../utils/secureV2'

export default defineEventHandler(async (event) => {
  noStoreSecureV2(event)
  requireSecureV2Available()
  const deviceId = getRouterParam(event, 'id')?.trim() || ''
  const body = await readBody<{ orgId?: string }>(event)
  const orgId = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
  const service = await serverSupabaseServiceRole(event)
  await authorizeSecureV2Device(event, service, deviceId, orgId)
  const metadata = await getSecureV2Metadata(service, deviceId)
  if (!metadata.enabled || !metadata.wireDeviceId) throw createError({ statusCode: 409, message: 'Enroll this device in Secure V2 first.' })
  const {user,requestId}=await requireOrgWriter(event,orgId,'devices.provision')
  const {data,error}=await (service as any).rpc('enterprise_sensitive_read',{p_org:orgId,p_actor:user.id,p_device:deviceId,p_request:requestId})
  if (error || !data || data.revoked_at || (data.expires_at && Date.parse(data.expires_at) <= Date.now())) {
    throw createError({ statusCode: 409, message: 'Secure V2 credentials need rotation.' })
  }
  return { ...metadata, credentials: exportSecureV2Credential(data) }
})

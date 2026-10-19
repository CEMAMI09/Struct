import { serverSupabaseServiceRole } from '#supabase/server'
import {requireOrgWriter} from '../../../utils/auth'
import { authorizeSecureV2Device, createSecureV2Credential, getSecureV2Metadata, noStoreSecureV2, requireSecureV2Available } from '../../../utils/secureV2'
import { sanitizeDeviceForClient } from '../../../utils/deviceCredentials'

export default defineEventHandler(async (event) => {
  noStoreSecureV2(event)
  requireSecureV2Available()
  const deviceId = getRouterParam(event, 'id')?.trim() || ''
  const body = await readBody<{ orgId?: string; action?: string; graceSeconds?: number }>(event)
  const orgId = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
  if (!['enroll', 'rotate'].includes(body?.action || '') || (body?.graceSeconds !== undefined
    && (!Number.isInteger(body.graceSeconds) || body.graceSeconds < 0 || body.graceSeconds > 86400))) {
    throw createError({ statusCode: 400, message: 'Choose enroll or rotate, with a grace period of 0..86400 seconds.' })
  }
  const service = await serverSupabaseServiceRole(event)
  const device = await authorizeSecureV2Device(event, service, deviceId, orgId)
  const credentials = createSecureV2Credential()
  const {user,requestId}=await requireOrgWriter(event,orgId,'devices.provision')
  const {data,error}=await (service as any).rpc('enterprise_device_admin',{p_org:orgId,p_actor:user.id,p_action:body.action,p_device:deviceId,p_request:requestId,p_data:{rootEncrypted:credentials.rootEncrypted,preview:credentials.preview,bootstrapEncrypted:credentials.bootstrapEncrypted,bootstrapHash:credentials.bootstrapHash.toString('hex'),grace:body.graceSeconds||0}})
  if (error || !data) throw createError({ statusCode: error?.message.includes('ENROLLED') ? 409 : 500,
    message: error?.message.includes('ENROLLED') ? 'Secure V2 enrollment changed. Refresh and retry.' : 'Secure V2 enrollment failed.' })
  const metadata = await getSecureV2Metadata(service, deviceId)
  return { ...metadata, device: sanitizeDeviceForClient({ ...device, secure_v2_enabled: true, wire_device_id: Number(data.wire_device_id) }),
    credentials: { wireDeviceId: Number(data.wire_device_id), rootSecret: credentials.rootSecret, bootstrapToken: credentials.bootstrapToken } }
})

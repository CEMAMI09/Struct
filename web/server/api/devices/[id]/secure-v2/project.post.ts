import { serverSupabaseServiceRole } from '#supabase/server'
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
  const { data, error } = await service.from('secure_v2_credentials')
    .select('wire_device_id,root_secret_encrypted,bootstrap_token_encrypted,revoked_at,expires_at')
    .eq('wire_device_id', metadata.wireDeviceId).eq('device_id', deviceId).single()
  if (error || !data || data.revoked_at || (data.expires_at && Date.parse(data.expires_at) <= Date.now())) {
    throw createError({ statusCode: 409, message: 'Secure V2 credentials need rotation.' })
  }
  return { ...metadata, credentials: exportSecureV2Credential(data) }
})

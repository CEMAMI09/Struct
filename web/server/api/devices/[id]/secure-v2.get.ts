import { serverSupabaseServiceRole } from '#supabase/server'
import { authorizeSecureV2Device, getSecureV2Metadata, noStoreSecureV2, secureV2Available } from '../../../utils/secureV2'

export default defineEventHandler(async (event) => {
  noStoreSecureV2(event)
  const deviceId = getRouterParam(event, 'id')?.trim() || ''
  const orgId = String(getQuery(event).orgId || '').trim()
  const service = await serverSupabaseServiceRole(event)
  await authorizeSecureV2Device(event, service, deviceId, orgId, false)
  if (!secureV2Available()) return { available: false, enabled: false, wireDeviceId: null, secretPreview: null, slots: [] }
  return getSecureV2Metadata(service, deviceId)
})

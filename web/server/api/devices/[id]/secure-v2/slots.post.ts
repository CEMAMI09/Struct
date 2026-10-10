import { serverSupabaseServiceRole } from '#supabase/server'
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
  const { data, error } = await service.rpc('publish_secure_v2_schema_slot', {
    p_device_id: deviceId, p_org_id: orgId, p_slot: slot.slot, p_encoding: slot.encoding,
    p_definition: slot.definition, p_record_bytes: slot.bytes,
    p_legacy_schema_version: slot.legacySchemaVersion, p_sample_interval_ms: slot.sampleIntervalMs,
  })
  if (error) throw createError({ statusCode: 409, message: error.message.includes('ALREADY_ASSIGNED')
    ? 'This schema slot is already assigned. Publish into an unused slot.' : 'Schema slot publication failed. Refresh and check the schema version.' })
  return data
})

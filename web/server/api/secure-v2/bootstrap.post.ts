import crypto from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import { noStoreSecureV2, requireSecureV2Available } from '../../utils/secureV2'

// Device provisioning is authorized by a single-use 256-bit token, not cookies.
// The root secret is never transmitted and a replay never returns counter zero.
export default defineEventHandler(async (event) => {
  noStoreSecureV2(event)
  requireSecureV2Available()
  const body = await readBody<{ wireDeviceId?: number; bootstrapToken?: string }>(event)
  if (!Number.isInteger(body?.wireDeviceId) || body.wireDeviceId! < 1 || body.wireDeviceId! > 0xffffffff
    || typeof body.bootstrapToken !== 'string' || !/^[a-f0-9]{64}$/i.test(body.bootstrapToken)) {
    throw createError({ statusCode: 400, message: 'Invalid provisioning request.' })
  }
  const hash = crypto.createHash('sha256').update(Buffer.from(body.bootstrapToken, 'hex')).digest('hex')
  const service = await serverSupabaseServiceRole(event)
  const { data, error } = await service.rpc('bootstrap_secure_v2_counter', {
    p_wire_device_id: Number(body.wireDeviceId), p_token_hash: `\\x${hash}`,
  })
  if (error || !data) throw createError({ statusCode: 409, message: 'Provisioning was not accepted. Existing counter state must be preserved; rotate credentials after state loss.' })
  return data as { nextSequence: number }
})

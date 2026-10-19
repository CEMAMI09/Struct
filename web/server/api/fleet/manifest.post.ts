import {ingestEndpoint} from '../../utils/ingestEndpoint'
import { uuid } from '../../utils/integrations'
import { fleetContext, fleetBody, fleetError } from '../../utils/fleet'
import { exportSecureV2Credential } from '../../utils/secureV2'
export default defineEventHandler(async (event) => {
  const b = await fleetBody(event),
    org = uuid(b.orgId),
    { service, user } = await fleetContext(event, org, true)
  if (
    b.confirm !== true ||
    !Array.isArray(b.deviceIds) ||
    !b.deviceIds.length ||
    b.deviceIds.length > 100
  )
    throw createError({
      statusCode: 400,
      message:
        'Explicit confirmation and 1–100 device IDs required. This download contains secrets.',
    })
  const key =
    process.env.TCP_CREDENTIAL_KEY || process.env.NUXT_TCP_CREDENTIAL_KEY || ''
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw createError({
      statusCode: 503,
      message: 'Provisioning export unavailable.',
    })
  const { data, error } = await service.rpc('fleet_manifest', {
    p_org: org,
    p_actor: user.id,
    p_job: uuid(b.jobId),
    p_ids: b.deviceIds.map(uuid),
  })
  fleetError(error)
  setHeader(
    event,
    'Content-Disposition',
    'attachment; filename="struct-private-provisioning.json"',
  )
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return {
    formatVersion: 1,
    warning:
      'PRIVATE device secrets. Store offline securely. Manual firmware provisioning required.',
    ingestHost: ingestEndpoint().host,
    udpPort: ingestEndpoint().port,
    devices: data.map((r: any) => ({
      deviceId: r.deviceId,
      name: r.name,
      externalId: r.externalId,
      serialNumber: r.serialNumber,
      ...exportSecureV2Credential(r),
    })),
  }
})

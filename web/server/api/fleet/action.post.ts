import { uuid } from '../../utils/integrations'
import { fleetBody, fleetContext, fleetError } from '../../utils/fleet'
export default defineEventHandler(async (event) => {
  const body = await fleetBody(event),
    org = uuid(body.orgId),
    { service, user } = await fleetContext(event, org, true)
  if (body.action === 'retry_preview') {
    const { data, error } = await service.rpc('fleet_retry_preview', {
      p_org: org,
      p_actor: user.id,
      p_job: uuid(body.jobId),
      p_request: uuid(body.requestId),
    })
    fleetError(error)
    return { jobId: data, scheduled: false }
  }
  const { error } = await service.rpc('fleet_job_action', {
    p_org: org,
    p_actor: user.id,
    p_job: uuid(body.jobId),
    p_action: body.action,
  })
  fleetError(error)
  return { scheduled: body.action === 'confirm' }
})

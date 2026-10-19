import { uuid } from '../../utils/integrations'
import { fleetContext, fleetError } from '../../utils/fleet'
export default defineEventHandler(async (event) => {
  const q = getQuery(event),
    org = uuid(q.orgId),
    { service } = await fleetContext(event, org),
    id = uuid(q.id),
    page = Number(q.page || 0)
  if (!Number.isInteger(page) || page < 0 || page > 100)
    throw createError({ statusCode: 400, message: 'Invalid result page.' })
  const { data: job, error } = await service
    .from('fleet_jobs')
    .select('id,operation,status,options,expires_at,created_at,completed_at')
    .eq('id', id)
    .eq('organization_id', org)
    .maybeSingle()
  fleetError(error)
  if (!job) throw createError({ statusCode: 404, message: 'Job not found.' })
  const [
    { data: items, error: itemsError },
    { data: counts, error: countsError },
  ] = await Promise.all([
    service
      .from('fleet_job_items')
      .select('item_index,input,device_id,expected_version,status,error_code')
      .eq('job_id', id)
      .order('item_index')
      .range(page * 100, page * 100 + 99),
    service.rpc('fleet_job_counts', { p_org: org, p_job: id }),
  ])
  fleetError(itemsError)
  fleetError(countsError)
  return { job, items: items || [], counts }
})

import { uuid } from '../../utils/integrations'
import { fleetContext, fleetFilter, fleetError } from '../../utils/fleet'
export default defineEventHandler(async (event) => {
  const q = getQuery(event),
    org = uuid(q.orgId),
    { service, user } = await fleetContext(event, org)
  let filter
  try {
    filter = fleetFilter(JSON.parse(String(q.filter || '{}')))
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid fleet filter.' })
  }
  const page = Number(q.page || 0)
  if (!Number.isInteger(page) || page < 0 || page > 2000)
    throw createError({ statusCode: 400, message: 'Invalid page.' })
  const { data, error } = await service.rpc('fleet_inventory', {
    p_org: org,
    p_actor: user.id,
    p_filter: filter,
    p_page: page,
    p_limit: 50,
  })
  fleetError(error)
  const [groups, jobs, tags] = await Promise.all([
    service.rpc('fleet_group_counts', { p_org: org, p_actor: user.id }),
    service
      .from('fleet_jobs')
      .select('id,operation,status,created_at,completed_at,expires_at')
      .eq('organization_id', org)
      .order('created_at', { ascending: false })
      .limit(20),
    service.rpc('fleet_label_counts', { p_org: org, p_actor: user.id }),
  ])
  fleetError(groups.error)
  fleetError(jobs.error)
  fleetError(tags.error)
  return {
    ...data,
    groups: groups.data || [],
    jobs: jobs.data || [],
    tags: tags.data || [],
  }
})

import { uuid } from '../../utils/integrations'
import {
  observabilityContext,
  monitoringFilter,
  monitoringError,
} from '../../utils/observability'
export default defineEventHandler(async (event) => {
  const q = getQuery(event),
    org = uuid(q.orgId),
    { service, user } = await observabilityContext(event, org)
  const page = Number(q.page || 0)
  if (!Number.isInteger(page) || page < 0 || page > 2000)
    throw createError({ statusCode: 400, message: 'Invalid page.' })
  let filter
  try {
    filter = monitoringFilter(q.filter)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid filter.' })
  }
  const r = await service.rpc('observability_overview', {
    p_org: org,
    p_actor: user.id,
    p_filter: filter,
    p_page: page,
  })
  monitoringError(r.error)
  return r.data
})

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
  const from = Date.parse(String(q.from)),
    to = Date.parse(String(q.to))
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    to - from > 366 * 86400000
  )
    throw createError({
      statusCode: 400,
      message: 'Choose a valid window up to 366 days.',
    })
  let filter
  try {
    filter = monitoringFilter(q.filter)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid filter.' })
  }
  const r = await service.rpc('usage_analytics', {
    p_org: org,
    p_actor: user.id,
    p_from: new Date(from).toISOString(),
    p_to: new Date(to).toISOString(),
    p_filter: filter,
  })
  monitoringError(r.error)
  return r.data
})

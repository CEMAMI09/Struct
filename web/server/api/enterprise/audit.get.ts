import {
  enterpriseContext,
  enterpriseError,
  enterpriseUuid as uuid,
} from '../../utils/enterprise'
export default defineEventHandler(async (event) => {
  const q = getQuery(event),
    org = uuid(q.orgId),
    { service, user } = await enterpriseContext(event, org, 'audit.read')
  let filter: Record<string, string> = {}
  for (const k of [
    'actor',
    'action',
    'resource',
    'id',
    'outcome',
    'reference',
    'from',
    'to',
  ])
    if (q[k]) {
      const value = String(q[k])
      if (value.length > 150)
        throw createError({ statusCode: 400, message: 'Invalid audit filter.' })
      if (['actor', 'id'].includes(k)) uuid(value)
      if (['from', 'to'].includes(k) && !Number.isFinite(Date.parse(value)))
        throw createError({ statusCode: 400, message: 'Invalid audit date.' })
      filter[k] = value
    }
  const limit = q.export === 'true' ? 500 : 50
  if (
    q.export === 'true' &&
    !['owner', 'admin'].includes(
      (await enterpriseContext(event, org, 'audit.export')).role,
    )
  )
    throw createError({ statusCode: 403, message: 'Export permission denied.' })
  const r = await service.rpc('enterprise_audit_search', {
    p_org: org,
    p_actor: user.id,
    p_filter: filter,
    p_before: q.before ? String(q.before) : null,
    p_before_id: q.beforeId ? uuid(q.beforeId) : null,
    p_limit: limit,
  })
  enterpriseError(r.error)
  return { events: r.data, limit, hasMore: r.data.length === limit }
})

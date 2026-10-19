import {
  managementContext,
  managementUuid,
  managementError,
} from '../../../utils/deviceManagement'
export default defineEventHandler(async (event) => {
  const q = getQuery(event),
    org = managementUuid(q.orgId),
    id = managementUuid(getRouterParam(event, 'id')),
    page = Number(q.page || 0)
  if (!Number.isInteger(page) || page < 0 || page > 2000)
    throw createError({ statusCode: 400, message: 'Invalid page.' })
  const { service, user } = await managementContext(event, org)
  const r = await service.rpc('management_rollout', {
    p_org: org,
    p_actor: user.id,
    p_id: id,
    p_page: page,
  })
  managementError(r.error)
  return r.data
})

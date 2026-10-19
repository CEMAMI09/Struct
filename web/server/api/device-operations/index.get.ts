import {
  managementContext,
  managementUuid,
  managementError,
} from '../../utils/deviceManagement'
export default defineEventHandler(async (event) => {
  const q = getQuery(event),
    org = managementUuid(q.orgId),
    { service, user } = await managementContext(event, org),
    page = Number(q.page || 0)
  if (!Number.isInteger(page) || page < 0 || page > 2000)
    throw createError({
      statusCode: 400,
      message: 'Invalid device operations page.',
    })
  const r = await service.rpc('management_overview', {
    p_org: org,
    p_actor: user.id,
    p_page: page,
    p_device: q.deviceId ? managementUuid(q.deviceId) : null,
  })
  managementError(r.error)
  return r.data
})

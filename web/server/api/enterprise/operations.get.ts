import {
  enterpriseContext,
  enterpriseError,
  enterpriseUuid as uuid,
} from '../../utils/enterprise'
export default defineEventHandler(async (event) => {
  const org = uuid(getQuery(event).orgId),
    { service, user } = await enterpriseContext(event, org, 'operations.read')
  const r = await service.rpc('enterprise_operations', {
    p_org: org,
    p_actor: user.id,
  })
  enterpriseError(r.error)
  return r.data
})

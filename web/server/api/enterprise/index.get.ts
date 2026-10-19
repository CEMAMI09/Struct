import {
  enterpriseContext,
  enterpriseError,
  enterpriseUuid as uuid,
} from '../../utils/enterprise'
export default defineEventHandler(async (event) => {
  const org = uuid(getQuery(event).orgId),
    { service, user } = await enterpriseContext(event, org)
  const page=Number(getQuery(event).page||0)
  if(!Number.isInteger(page)||page<0||page>2000)throw createError({statusCode:400,message:'Invalid member page.'})
  const r = await service.rpc('enterprise_overview', {
    p_org: org,
    p_actor: user.id,
    p_page: page,
  })
  enterpriseError(r.error)
  return r.data
})

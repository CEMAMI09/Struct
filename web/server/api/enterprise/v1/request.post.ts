import {
  enterpriseBody,
  parseManagementSecret,
  enterpriseError,
  enterpriseRate,
} from '../../../utils/enterprise'
import { serverSupabaseServiceRole } from '#supabase/server'
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (process.env.STRUCT_ENTERPRISE_ENABLED !== 'true')
    throw createError({
      statusCode: 503,
      message: 'Enterprise operations are disabled.',
    })
  const auth = getHeader(event, 'authorization')
  if (!auth?.startsWith('Bearer stk_'))
    throw createError({
      statusCode: 401,
      message: 'Management credential required.',
    })
  const { id, hash } = parseManagementSecret(auth.slice(11))
  enterpriseRate('key:' + id)
  const b = await enterpriseBody(event),
    service: any = await serverSupabaseServiceRole(event)
  const r = await service.rpc('enterprise_machine_request', {
    p_id: id,
    p_hash: `\\x${hash}`,
    p_action: b.action,
    p_data: b.data || {},
  })
  enterpriseError(r.error)
  return r.data
})

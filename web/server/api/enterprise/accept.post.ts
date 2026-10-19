import {
  enterpriseUser,
  enterpriseBody,
  enterpriseError,
  parseManagementSecret,
} from '../../utils/enterprise'
import { serverSupabaseServiceRole } from '#supabase/server'
export default defineEventHandler(async (event) => {
  const user = await enterpriseUser(event),
    b = await enterpriseBody(event),
    { id, hash } = parseManagementSecret(b.token),
    service: any = await serverSupabaseServiceRole(event)
  const r = await service.rpc('enterprise_accept_invitation', {
    p_actor: user.id,
    p_id: id,
    p_hash: `\\x${hash}`,
  })
  enterpriseError(r.error)
  return { organizationId: r.data }
})

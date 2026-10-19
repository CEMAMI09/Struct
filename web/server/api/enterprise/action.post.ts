import {
  enterpriseContext,
  enterpriseBody,
  enterpriseError,
  newManagementSecret,
  applicationOrigin,
  enterpriseUuid as uuid,
} from '../../utils/enterprise'
import { encryptApiSecret } from '../../utils/deviceCredentials'
export default defineEventHandler(async (event) => {
  const b = await enterpriseBody(event),
    org = uuid(b.orgId),
    action = String(b.action),
    d = b.data || {}
  if (!d || typeof d !== 'object' || Array.isArray(d))
    throw createError({ statusCode: 400, message: 'Invalid action data.' })
  const teamCaps: Record<string, string> = {
    rename: 'organization.manage',
    invite: 'members.invite',
    resend: 'members.invite',
    revoke_invite: 'members.invite',
    remove: 'members.remove',
    role: 'members.manage_roles',
    transfer: 'organization.transfer',
  }
  const isKey = ['key_create', 'key_rotate', 'key_revoke'].includes(action),
    cap = isKey ? 'api_keys.manage' : teamCaps[action]
  if (!cap)
    throw createError({
      statusCode: 400,
      message: 'Unsupported enterprise action.',
    })
  // Validate link configuration before committing a token that cannot be recovered.
  const invitationOrigin = ['invite', 'resend'].includes(action)
    ? applicationOrigin()
    : undefined
  const { service, user, requestId } = await enterpriseContext(event, org, cap)
  let secret: ReturnType<typeof newManagementSecret> | undefined,
    data: Record<string, any> = {}
  if (action === 'rename') data = { name: d.name }
  else if (['remove', 'role', 'transfer'].includes(action))
    data = {
      member: uuid(d.member),
      ...(action === 'role' ? { role: d.role } : {}),
    }
  else if (action === 'revoke_invite' || action === 'key_revoke')
    data = { id: uuid(d.id) }
  else if (['invite', 'resend', 'key_create', 'key_rotate'].includes(action)) {
    secret = newManagementSecret(d.id ? uuid(d.id) : undefined)
    data = { id: secret.id, hash: secret.hash }
    if (action === 'invite')
      Object.assign(data, { email: d.email, role: d.role })
    if (['invite', 'resend'].includes(action) && d.sendEmail === true)
      Object.assign(data, {
        sendEmail: true,
        mail_cipher: encryptApiSecret(secret.secret),
      })
    if (action === 'key_create')
      Object.assign(data, { name: d.name, scopes: d.scopes, days: d.days })
  }
  const r = await service.rpc(
    isKey ? 'enterprise_key_command' : 'enterprise_team_command',
    {
      p_org: org,
      p_actor: user.id,
      p_action: isKey ? action.slice(4) : action,
      p_data: data,
      p_request: requestId,
    },
  )
  enterpriseError(r.error)
  // An ambiguous/repeated invitation cannot redisclose its old token. Resend rotates it.
  return {
    ...r.data,
    requestId,
    ...(secret && !r.data?.duplicate
      ? isKey
        ? { credential: `stk_${secret.token}` }
        : {
            invitationLink: `${invitationOrigin}/invite#token=${secret.token}`,
          }
      : {}),
  }
})

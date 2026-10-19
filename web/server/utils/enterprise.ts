import type { H3Event } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { requireOrgWriter } from './auth'
import { uuid } from './integrations'
export const enterpriseUuid = uuid
const limits = new Map<string, { at: number; count: number }>()
export function enterpriseRate(key: string, maximum = 120) {
  const now = Date.now(),
    r = limits.get(key)
  if (r && now - r.at < 60000) {
    if (++r.count > maximum)
      throw createError({
        statusCode: 429,
        message: 'Too many enterprise requests. Try again shortly.',
      })
  } else {
    if (limits.size >= 4096) limits.delete(limits.keys().next().value!)
    limits.set(key, { at: now, count: 1 })
  }
}
export async function enterpriseContext(
  event: H3Event,
  org: string,
  cap = 'organization.read',
) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (process.env.STRUCT_ENTERPRISE_ENABLED !== 'true')
    throw createError({
      statusCode: 503,
      message:
        'Enterprise operations require migrations 039/040 and explicit activation.',
    })
  const { user, role, requestId } = await requireOrgWriter(
    event,
    uuid(org),
    cap,
  )
  enterpriseRate(`${org}:${user.id}:${cap}`, cap.endsWith('.read') ? 120 : 30)
  const service: any = await serverSupabaseServiceRole(event)
  const flag = await service
    .from('enterprise_settings')
    .select('enabled')
    .eq('id', true)
    .single()
  if (flag.error || !flag.data?.enabled)
    throw createError({
      statusCode: 503,
      message: 'Enterprise database activation is required.',
    })
  setHeader(event, 'X-Struct-Request-ID', requestId)
  return { service, user, role, requestId }
}
export async function enterpriseBody(event: H3Event) {
  if (
    getHeader(event, 'sec-fetch-site') === 'cross-site' ||
    !getHeader(event, 'content-type')?.startsWith('application/json')
  )
    throw createError({ statusCode: 400, message: 'Same-site JSON required.' })
  const origin = getHeader(event, 'origin')
  if (origin && origin !== getRequestURL(event).origin)
    throw createError({ statusCode: 403, message: 'Request origin denied.' })
  const parts: Buffer[] = []
  let size = 0
  for await (const c of event.node.req) {
    const b = Buffer.from(c)
    size += b.length
    if (size > 16384)
      throw createError({
        statusCode: 413,
        message: 'Enterprise request exceeds 16 KiB.',
      })
    parts.push(b)
  }
  try {
    const b = JSON.parse(Buffer.concat(parts).toString('utf8'))
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw Error()
    return b as Record<string, any>
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid JSON.' })
  }
}
export function enterpriseError(error: any) {
  if (!error) return
  const code =
    String(error.message).match(
      /PERMISSION_DENIED|ENTERPRISE_DISABLED|TEAM_REQUIRES_SCALE|AUDIT_REQUIRES_SCALE|[A-Z_]+_LIMIT|LAST_OWNER|USE_EXPLICIT_TRANSFER|INVITATION_[A-Z_]+|ALREADY_MEMBER|KEY_REVOKED|INVALID_[A-Z_]+|UNSUPPORTED_SCOPE/,
    )?.[0] || 'ENTERPRISE_OPERATION_FAILED'
  throw createError({
    statusCode:
      code === 'INVALID_MANAGEMENT_KEY'
        ? 401
        : code.includes('PERMISSION')
          ? 403
          : code.includes('DISABLED')
            ? 503
            : code.includes('LIMIT')
              ? 429
              : code.includes('OWNER') || code.includes('MEMBER')
                ? 409
                : 400,
    message: code.toLowerCase().replaceAll('_', ' '),
    data: { code },
  })
}
export function newManagementSecret(id: string = randomUUID()) {
  const secret = randomBytes(32).toString('hex')
  return {
    id,
    secret,
    hash: createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex'),
    token: `${id}.${secret}`,
  }
}
export function parseManagementSecret(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^([a-f0-9-]{36})\.([a-f0-9]{64})$/i.test(value)
  )
    throw createError({ statusCode: 401, message: 'Credential unavailable.' })
  const [id, secret] = value.split('.')
  return {
    id: uuid(id),
    hash: createHash('sha256')
      .update(Buffer.from(secret!, 'hex'))
      .digest('hex'),
  }
}
export function applicationOrigin() {
  const url = new URL(process.env.STRUCT_APP_URL || 'https://usestruct.com')
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      ))
  )
    throw createError({
      statusCode: 503,
      message: 'Application origin is not configured safely.',
    })
  return url.origin
}
export async function enterpriseUser(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (process.env.STRUCT_ENTERPRISE_ENABLED !== 'true')
    throw createError({
      statusCode: 503,
      message: 'Enterprise operations are disabled.',
    })
  const client = await serverSupabaseClient(event),
    {
      data: { user },
      error,
    } = await client.auth.getUser()
  if (error || !user)
    throw createError({
      statusCode: 401,
      message: 'Sign in to accept this invitation.',
    })
  enterpriseRate(user.id + ':invite', 20)
  return user
}

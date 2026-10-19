import type { H3Event } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
import { uuid } from './integrations'
import {hasPermission} from '#shared/permissions'
// Per-process guard, not a substitute for deployment-level DDoS protection.
const requestLimits = new Map<string, { until: number; count: number }>()
export async function observabilityContext(
  event: H3Event,
  org: string,
  write:boolean|string = false,
) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (process.env.STRUCT_OBSERVABILITY_ENABLED !== 'true')
    throw createError({
      statusCode: 503,
      message: 'Monitoring requires migration 038 and explicit activation.',
    })
  const client = await serverSupabaseClient(event),
    {
      data: { user },
    } = await client.auth.getUser()
  if (!user)
    throw createError({
      statusCode: 401,
      message: 'Sign in to view workspace monitoring.',
    })
  const membership = await client
    .from('organization_members')
    .select('role')
    .eq('organization_id', org)
    .eq('user_id', user.id)
    .maybeSingle()
  if (
    membership.error ||
    !membership.data ||
    !hasPermission(membership.data.role,typeof write==='string'?write:write?'alerts.manage':'alerts.read')
  )
    throw createError({
      statusCode: 403,
      message: 'Workspace permission denied.',
    })
  const now = Date.now(),
    key = `${org}:${user.id}:${write ? 'write' : 'read'}`,
    limit = requestLimits.get(key)
  if (limit && limit.until > now) {
    if (++limit.count > (write ? 60 : 240))
      throw createError({
        statusCode: 429,
        message:
          'Please wait a minute before requesting more monitoring operations.',
      })
  } else {
    if (requestLimits.size >= 4096)
      requestLimits.delete(requestLimits.keys().next().value!)
    requestLimits.set(key, { until: now + 60000, count: 1 })
  }
  const service: any = await serverSupabaseServiceRole(event)
  const enabled = await service
    .from('observability_settings')
    .select('enabled')
    .eq('id', true)
    .single()
  if (enabled.error || !enabled.data?.enabled)
    throw createError({
      statusCode: 503,
      message: 'Monitoring database is not activated.',
    })
  return { service, user }
}
export async function observabilityBody(event: H3Event) {
  if (
    getHeader(event, 'sec-fetch-site') === 'cross-site' ||
    !getHeader(event, 'content-type')?.startsWith('application/json')
  )
    throw createError({ statusCode: 400, message: 'Same-site JSON required.' })
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const c of event.node.req) {
    const b = Buffer.from(c)
    bytes += b.length
    if (bytes > 16384)
      throw createError({
        statusCode: 413,
        message: 'Configuration exceeds 16 KB.',
      })
    chunks.push(b)
  }
  try {
    const b = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw Error()
    return b as Record<string, any>
  } catch {
    throw createError({
      statusCode: 400,
      message: 'Invalid configuration JSON.',
    })
  }
}
export function monitoringFilter(raw: unknown) {
  const f: Record<string, unknown> = {}
  if (!raw) return f
  const r = typeof raw === 'string' ? JSON.parse(raw) : (raw as any)
  if (!r || typeof r !== 'object' || Array.isArray(r))
    throw Error('Invalid filter')
  for (const k of ['device', 'group']) if (r[k]) f[k] = uuid(r[k])
  for (const k of ['search', 'status', 'tag'])
    if (r[k]) {
      if (typeof r[k] !== 'string' || r[k].length > 128)
        throw Error('Invalid filter')
      f[k] = r[k]
    }
  if (r.slot !== undefined) {
    if (!Number.isInteger(r.slot) || r.slot < 0 || r.slot > 15)
      throw Error('Invalid schema slot')
    f.slot = r.slot
  }
  if (r.incidentState) {
    if (!['active', 'history', 'all'].includes(r.incidentState))
      throw Error('Invalid incident filter')
    f.incidentState = r.incidentState
  }
  if (r.view) {
    if (!['errors', 'alerts'].includes(r.view))
      throw Error('Invalid attention view')
    f.view = r.view
  }
  if (r.incidentPage !== undefined) {
    if (
      !Number.isInteger(r.incidentPage) ||
      r.incidentPage < 0 ||
      r.incidentPage > 2000
    )
      throw Error('Invalid incident page')
    f.incidentPage = r.incidentPage
  }
  return f
}
export function monitoringError(error: any) {
  if (!error) return
  const code =
    String(error.message).match(
      /OBSERVABILITY_FORBIDDEN|OBSERVABILITY_DISABLED|RULE_VERSION_CONFLICT|INVALID_[A-Z_]+|[A-Z_]+_LIMIT|RESOLVE_ACTIVE_RULE_BEFORE_EDIT|RULE_DELETED/,
    )?.[0] || 'MONITORING_CONFIGURATION_FAILED'
  throw createError({
    statusCode: code.includes('FORBIDDEN')
      ? 403
      : code.includes('VERSION_CONFLICT')
        ? 409
        : 400,
    message: code.toLowerCase().replaceAll('_', ' '),
  })
}

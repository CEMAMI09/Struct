import type { H3Event } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
import { requireOrgWriter } from './auth'
import * as core from '../../../tcp-server/integrations/index.js'
import { randomUUID } from 'node:crypto'
export { core }
export const SAFE_INTEGRATION_FIELDS =
  'destination_id,organization_id,kind,version,config,route,mapping,updated_at,last_check,last_checked_at,destination:destinations!inner(name,enabled,paused_at)'
export function requireIntegrations() {
  if (process.env.STRUCT_INTEGRATIONS_ENABLED !== 'true')
    throw createError({
      statusCode: 503,
      message: 'Backend integrations are not activated in this deployment.',
    })
}
export function uuid(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw createError({
      statusCode: 400,
      message: 'Valid workspace/destination ID required',
    })
  return value
}
export async function bodyBounded(
  event: H3Event,
): Promise<Record<string, any>> {
  if (
    getHeader(event, 'sec-fetch-site') === 'cross-site' ||
    !getHeader(event, 'content-type')?.startsWith('application/json')
  )
    throw createError({
      statusCode: 400,
      message: 'Same-site JSON request required',
    })
  let size = 0
  const parts: Buffer[] = []
  for await (const part of event.node.req) {
    const b = Buffer.from(part)
    size += b.length
    if (size > 65536)
      throw createError({
        statusCode: 413,
        message: 'Integration request exceeds 64 KiB',
      })
    parts.push(b)
  }
  try {
    const body = JSON.parse(Buffer.concat(parts).toString())
    if (!body || Array.isArray(body) || typeof body !== 'object')
      throw new Error()
    return body
  } catch {
    throw createError({
      statusCode: 400,
      message: 'Invalid JSON configuration',
    })
  }
}
export async function context(event: H3Event, orgId: string, write = false) {
  requireIntegrations()
  setHeader(event, 'cache-control', 'no-store')
  const client = await serverSupabaseClient(event)
  if (write) {
    const { user } = await requireOrgWriter(event, orgId, 'integrations.manage')
    return { service: await serverSupabaseServiceRole(event), client, user }
  }
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (error || !user)
    throw createError({ statusCode: 401, message: 'Not authenticated' })
  const { data: member, error: memberError } = await client
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (memberError || !member)
    throw createError({ statusCode: 403, message: 'Workspace access denied' })
  return { service: await serverSupabaseServiceRole(event), client, user }
}
export function databaseError(error: { message: string } | null) {
  if (!error) return
  const message = error.message
  if (message.includes('CONFLICT'))
    throw createError({
      statusCode: 409,
      message: 'Configuration changed. Reload before saving.',
    })
  if (/RATE_LIMIT/.test(message))
    throw createError({
      statusCode: 429,
      message: 'Too many integration actions. Try again in one minute.',
    })
  if (/Scale|safety limit|DISABLED/.test(message))
    throw createError({ statusCode: 400, message: message.split('\n')[0] })
  throw createError({
    statusCode: 400,
    message:
      'Integration action could not be completed. Check permissions and configuration.',
  })
}
export async function save(event: H3Event) {
  const body = await bodyBounded(event),
    orgId = uuid(body.orgId),
    id = body.id ? uuid(body.id) : randomUUID(),
    { service, user } = await context(event, orgId, true)
  try {
    if (
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.length > 100
    )
      throw new Error('Name must be 1–100 characters')
    const kind = body.kind as core.IntegrationKind,
      config = core.validateConfig(kind, body.config),
      route = core.validateRoute(body.route),
      mapping = core.validateMapping(body.mapping)
    const credentials = body.credentials
      ? core.seal(core.validateCredentials(kind, body.credentials), orgId, id)
      : null
    const version = body.id ? body.version : 0
    if (!Number.isInteger(version) || version < 0)
      throw new Error('Configuration version required')
    const { data, error } = await service.rpc(
      'save_integration' as never,
      {
        p_org_id: orgId,
        p_actor_id: user.id,
        p_destination_id: id,
        p_name: body.name.trim(),
        p_kind: kind,
        p_config: config,
        p_route: route,
        p_mapping: mapping,
        p_credentials: credentials,
        p_expected_version: version,
        p_enabled: body.enabled === true,
      } as never,
    )
    databaseError(error)
    return { id, version: data }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({
      statusCode: 400,
      message:
        error.code === 'INTEGRATION_CONFIG' || error.code === 'WEBHOOK_POLICY'
          ? error.message
          : 'Invalid integration configuration or unavailable secret encryption key',
    })
  }
}

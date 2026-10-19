import type { H3Event } from 'h3'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
import { randomUUID } from 'node:crypto'
import { hasPermission } from '#shared/permissions'
// Request-local only: never cache membership across requests or tenants.
const authorization = new WeakMap<object, Map<string, Promise<any>>>()
const denialWindows = new Map<string, number>()
/** Compatibility name; every caller supplies an explicit capability. Unknown capabilities deny. */
export async function requireOrgWriter(
  event: H3Event,
  orgId: string,
  capability = 'unclassified',
) {
  let cache = authorization.get(event)
  if (!cache) {
    cache = new Map()
    authorization.set(event, cache)
  }
  let load = cache.get(orgId)
  if (!load) {
    load = (async () => {
      const supabase = await serverSupabaseClient(event),
        {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()
      if (authError || !user)
        throw createError({ statusCode: 401, message: 'Not authenticated' })
      const { data: membership, error: memberError } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (memberError)
        throw createError({
          statusCode: 503,
          message: 'Workspace authorization unavailable.',
        })
      return {
        supabase,
        user,
        role: membership?.role || null,
        requestId: event.context?.structRequestId || randomUUID(),
      }
    })()
    cache.set(orgId, load)
  }
  const context = await load
  if (!hasPermission(context.role, capability)) {
    const key = orgId + ':' + context.user.id,
      now = Date.now()
    if (
      context.role &&
      process.env.STRUCT_ENTERPRISE_ENABLED === 'true' &&
      now - (denialWindows.get(key) || 0) > 2000
    ) {
      if (denialWindows.size >= 4096)
        denialWindows.delete(denialWindows.keys().next().value!)
      denialWindows.set(key, now)
      try {
        const service: any = await serverSupabaseServiceRole(event),
          call = service.rpc('enterprise_record_denied', {
            p_org: orgId,
            p_actor: context.user.id,
            p_cap: capability,
            p_request: context.requestId,
          })
        await (typeof call.abortSignal === 'function'
          ? call.abortSignal(AbortSignal.timeout(2000))
          : call)
      } catch {
        /* A failed denial audit must never authorize the request. */
      }
    }
    throw createError({
      statusCode: 403,
      message: `Permission denied: ${capability}. Ask a workspace administrator for access.`,
    })
  }
  setHeader(event, 'X-Struct-Request-ID', context.requestId)
  return context
}

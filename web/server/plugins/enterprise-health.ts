import { randomUUID } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import { heartbeat } from '../../../tcp-server/enterprise/health.js'
/** Private sampled runtime health; no query strings, payloads or exception bodies. */
export default defineNitroPlugin((nitro) => {
  if (process.env.STRUCT_ENTERPRISE_ENABLED !== 'true') return
  const starts = new WeakMap<object, number>(),
    metrics = { requests: 0, errors: 0, processing_ms: 0 },
    interval = { current: null as ReturnType<typeof heartbeat> | null }
  nitro.hooks.hook('request', (event) => {
    event.context.structRequestId = randomUUID()
    setHeader(event, 'X-Struct-Request-ID', event.context.structRequestId)
    starts.set(event, performance.now())
    if (!interval.current) {
      try {
        const db = serverSupabaseServiceRole(event)
        interval.current = heartbeat(
          db,
          'web',
          () => true,
          () => metrics,
        )
      } catch {
        /* Missing private configuration must not expose secrets or fabricate readiness. */
      }
    }
  })
  nitro.hooks.hook('afterResponse', (event) => {
    const start = starts.get(event)
    metrics.requests++
    if (start !== undefined) metrics.processing_ms += performance.now() - start
  })
  nitro.hooks.hook('error', (_error, context) => {
    metrics.errors++
    const event = context.event
    if (event)
      console.warn(
        JSON.stringify({
          type: 'web_runtime_error',
          requestId: event.context.structRequestId || null,
        }),
      )
  })
  nitro.hooks.hook('close', async () => {
    await interval.current?.stop()
  })
})

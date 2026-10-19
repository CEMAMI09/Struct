require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const { startOutbox } = require('./outbox')
const http = require('node:http')
async function main() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing worker database configuration')
  const port = Number(process.env.OUTBOX_HEALTH_PORT || 0)
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid worker health port')
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init = {}) =>
        fetch(input, {
          ...init,
          signal: init.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
        }),
    },
  })
  const pipelineV2 = process.env.STRUCT_DELIVERY_PIPELINE_V2 === 'true'
  if (pipelineV2) {
    const { data, error } = await supabase.rpc('delivery_pipeline_health')
    if (error || data?.version !== 2 || data?.enabled !== true)
      throw new Error(
        'Delivery v2 requires migration 035 and explicit database activation',
      )
  }
  if (process.env.STRUCT_INTEGRATIONS_ENABLED === 'true') {
    if (
      !pipelineV2 ||
      !/^[a-f0-9]{64}$/i.test(process.env.STRUCT_INTEGRATION_KEY || '')
    )
      throw new Error('Integration prerequisites unavailable')
    const { data, error } = await supabase
      .from('integration_settings')
      .select('enabled')
      .eq('id', true)
      .maybeSingle()
    if (error || !data?.enabled)
      throw new Error('Integration database activation required')
  }
  const stop = startOutbox(supabase, { pipelineV2 })
  const enterpriseHealth=require('./enterprise/health').heartbeat(supabase,'delivery',()=>stop.metrics().healthy,()=>stop.metrics())
  let server = null,
    shuttingDown = false
  if (port) {
    server = http.createServer((req, res) => {
      if (req.url !== '/health' || req.method !== 'GET') {
        res.writeHead(404).end()
        return
      }
      const metrics = stop.metrics()
      res
        .writeHead(shuttingDown || !metrics.healthy ? 503 : 200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        .end(JSON.stringify({ version: 2, pipelineV2, ...metrics }))
    })
    server.on('error', async () => {
      console.error('Worker health listener failed')
      await shutdown()
      process.exitCode = 1
    })
    server.listen(port, '127.0.0.1')
  }
  const report = setInterval(
    () =>
      console.log(
        JSON.stringify({ type: 'delivery_worker_metrics', ...stop.metrics() }),
      ),
    30000,
  )
  report.unref()
  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(report)
    server?.close()
    await enterpriseHealth.stop()
    await stop()
    await require('./integrations/adapters').closePools()
  }
  process.once('SIGTERM', () => void shutdown())
  process.once('SIGINT', () => void shutdown())
  console.log(
    JSON.stringify({
      type: 'delivery_worker_started',
      pipelineV2,
      pid: process.pid,
    }),
  )
}
main().catch(() => {
  console.error(
    'Delivery worker startup failed; check database migration, activation and private configuration',
  )
  process.exitCode = 1
})

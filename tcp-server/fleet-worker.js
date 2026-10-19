require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
async function main() {
  if (
    process.env.STRUCT_FLEET_ENABLED !== 'true' ||
    !/^[a-f0-9]{64}$/i.test(process.env.TCP_CREDENTIAL_KEY || '')
  )
    throw new Error()
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error()
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url, init = {}) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    },
  )
  const { data, error } = await db
    .from('fleet_settings')
    .select('enabled')
    .eq('id', true)
    .single()
  if (error || !data.enabled) throw new Error()
  const worker = require('./fleet/worker').start(db)
  const health=require('./enterprise/health').heartbeat(db,'fleet',()=>!!worker.metrics.lastSuccessAt&&Date.now()-Date.parse(worker.metrics.lastSuccessAt)<60000,()=>worker.metrics)
  const report = setInterval(
    () =>
      console.log(JSON.stringify({ type: 'fleet_worker', ...worker.metrics })),
    30000,
  )
  async function stop() {
    clearInterval(report)
    await health.stop()
    await worker.stop()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  console.log('Fleet worker started')
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Fleet worker requires migration 037, explicit activation and private server credentials',
    )
    process.exitCode = 1
  })
module.exports = { main }

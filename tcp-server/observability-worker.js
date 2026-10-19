require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
async function main() {
  if (
    process.env.STRUCT_OBSERVABILITY_ENABLED !== 'true' ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
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
  const flag = await db
    .from('observability_settings')
    .select('enabled')
    .eq('id', true)
    .single()
  if (flag.error || !flag.data?.enabled) throw new Error()
  const worker = require('./observability/worker').start(db)
  const health=require('./enterprise/health').heartbeat(db,'observability',()=>!!worker.metrics.lastSuccess&&Date.now()-Date.parse(worker.metrics.lastSuccess)<60000,()=>worker.metrics)
  const report = setInterval(
    () =>
      console.log(
        JSON.stringify({ type: 'observability_worker', ...worker.metrics }),
      ),
    30000,
  )
  async function stop() {
    clearInterval(report)
    await health.stop()
    await worker.stop()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  console.log(
    'Observability worker started; email requires explicit credentials and opt-in preferences',
  )
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Observability worker requires migration 038, database activation and private service credentials',
    )
    process.exitCode = 1
  })
module.exports = { main }

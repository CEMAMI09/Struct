if (require.main === module) require('dotenv').config()
async function main() {
  if (
    process.env.STRUCT_DEVICE_OPERATIONS_ENABLED !== 'true' ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw Error()
  const db = require('@supabase/supabase-js').createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url, options = {}) =>
          fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
      },
    },
  )
  const flag = await db
    .from('management_settings')
    .select('enabled')
    .eq('id', true)
    .single()
  if (flag.error || !flag.data?.enabled) throw Error()
  const worker = require('./management/worker').start(db),
    health = require('./enterprise/health').heartbeat(
      db,
      'management',
      () =>
        !!worker.metrics.lastSuccess &&
        Date.now() - Date.parse(worker.metrics.lastSuccess) < 60000,
      () => worker.metrics,
    )
  async function stop() {
    await worker.stop()
    await health.stop()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  console.log(
    'Device operations scheduler started; no devices are updated without confirmed assignments',
  )
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Management worker requires migration 041, explicit activation and private configuration',
    )
    process.exitCode = 1
  })
module.exports = { main }

// Operator-only read of queue metrics. Does not print destinations, payloads or secrets.
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
async function main() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw new Error('Missing private worker database configuration')
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.rpc('delivery_pipeline_health')
  if (error)
    throw new Error(
      'Unable to read delivery health; check migration and database access',
    )
  console.log(
    JSON.stringify({ observed_at: new Date().toISOString(), ...data }, null, 2),
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

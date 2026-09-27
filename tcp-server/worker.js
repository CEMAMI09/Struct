require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const { startOutbox } = require('./outbox')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const stop = startOutbox(supabase)
let draining = false
async function shutdown() {
  if (draining) return
  draining = true
  try {
    await stop()
    process.exitCode = 0
  } catch (error) {
    console.error('Outbox worker shutdown failed:', error)
    process.exitCode = 1
  }
}
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })

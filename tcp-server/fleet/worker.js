const crypto = require('node:crypto')
const { encryptSecret } = require('../auth')

// Same per-device credential format as web/server/utils/secureV2.ts.
// Plaintext exists only in this call's memory; never enters the job record.
function credentials() {
  const api = crypto.randomBytes(32).toString('hex')
  const root = crypto.randomBytes(32).toString('hex')
  const bootstrap = crypto.randomBytes(32).toString('hex')
  return {
    key_id: crypto.randomBytes(8).toString('hex'),
    api_encrypted: encryptSecret(api),
    api_preview: api.slice(-4),
    root_encrypted: encryptSecret(root),
    root_preview: root.slice(-4),
    bootstrap_encrypted: encryptSecret(bootstrap),
    bootstrap_hash: crypto
      .createHash('sha256')
      .update(Buffer.from(bootstrap, 'hex'))
      .digest('hex'),
  }
}
async function tick(db) {
  const { data, error } = await db.rpc('fleet_claim')
  if (error) throw new Error('Fleet claim unavailable')
  if (!data) return false
  const { job, item } = data
  const result = await db.rpc('fleet_finish', {
    p_job: job.id,
    p_index: item.item_index,
    p_token: item.lease_token,
    p_credentials: ['create', 'reprovision'].includes(job.operation)
      ? credentials()
      : null,
  })
  if (result.error)
    throw new Error('Fleet completion unavailable; lease will recover')
  return true
}
function start(db) {
  let stopped = false,
    timer,
    inflight = Promise.resolve()
  const metrics = { processed: 0, errors: 0, lastSuccessAt: null }
  let polls = 0
  const loop = async () => {
    try {
      if (++polls % 3600 === 0) {
        const { error } = await db.rpc('fleet_cleanup')
        if (error) throw new Error('Fleet cleanup unavailable')
      }
      const worked = await tick(db)
      metrics.lastSuccessAt = new Date().toISOString()
      if (worked) metrics.processed++
      if (!stopped)
        timer = setTimeout(
          () => {
            inflight = loop()
          },
          worked ? 10 : 1000,
        )
    } catch {
      metrics.errors++
      if (!stopped)
        timer = setTimeout(() => {
          inflight = loop()
        }, 3000)
    }
  }
  inflight = loop()
  return {
    metrics,
    async stop() {
      stopped = true
      clearTimeout(timer)
      await inflight
    },
  }
}
module.exports = { credentials, tick, start }

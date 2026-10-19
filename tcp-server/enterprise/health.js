'use strict'
const { randomUUID } = require('node:crypto')
// No hostnames, credentials, payloads or arbitrary exception messages are recorded.
function heartbeat(
  db,
  component,
  ready = () => true,
  details = () => ({}),
  interval = 20000,
) {
  if (process.env.STRUCT_ENTERPRISE_ENABLED !== 'true')
    return {
      stop() {},
      async sample() {
        return false
      },
    }
  const instance = randomUUID()
  let stopped = false,
    timer,
    pending = null,
    lastRoundtrip = null
  async function sample() {
    if (stopped || pending) return false
    pending = (async () => {
      const begin = performance.now()
      try {
        const call = db.rpc('enterprise_heartbeat', {
          p_instance: instance,
          p_component: component,
          p_ready: !!ready(),
          p_details: { ...details(), db_roundtrip_ms: lastRoundtrip },
        })
        const r=await (typeof call.abortSignal==='function'?call.abortSignal(AbortSignal.timeout(5000)):call)
        if (r.error) throw Error()
        lastRoundtrip = performance.now() - begin
        return true
      } catch {
        return false
      } finally {
        pending = null
      }
    })()
    return pending
  }
  void sample()
  timer = setInterval(() => void sample(), interval)
  timer.unref()
  return {
    sample,
    async stop() {
      stopped = true
      clearInterval(timer)
      await pending
    },
  }
}
module.exports = { heartbeat }

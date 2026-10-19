'use strict'
// Scheduling is one bounded PostgreSQL transaction; no HTTP or firmware bytes
// enter this worker. Row locks/SKIP LOCKED recover automatically on process death.
function start(db) {
  let stopped = false,
    timer,
    active = Promise.resolve(),
    rounds = 0
  const metrics = { cycles: 0, errors: 0, scheduled: 0, lastSuccess: null }
  async function loop() {
    let wait = 1000
    try {
      const r = await db.rpc('management_tick', { p_limit: 50 })
      if (r.error) throw Error()
      metrics.scheduled += r.data?.scheduled || 0
      metrics.cycles++
      metrics.lastSuccess = new Date().toISOString()
      if (r.data?.scheduled) wait = 100
      if (++rounds % 3600 === 0) {
        const c = await db.rpc('management_cleanup')
        if (c.error) throw Error()
      }
    } catch {
      metrics.errors++
      wait = 3000
    }
    if (!stopped)
      timer = setTimeout(() => {
        active = loop()
      }, wait)
  }
  active = loop()
  return {
    metrics,
    async stop() {
      stopped = true
      clearTimeout(timer)
      await active
    },
  }
}
module.exports = { start }

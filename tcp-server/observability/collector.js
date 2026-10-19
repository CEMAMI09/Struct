'use strict'
const { randomUUID } = require('node:crypto')
// Attempt/receipt observations are best effort and bounded. Commit metrics are atomic in SQL.
const queues = new WeakMap()
const enabled = () => process.env.STRUCT_OBSERVABILITY_ENABLED === 'true'
const health = {
  queued: 0,
  dropped: 0,
  unattributed: 0,
  failedFlushes: 0,
  commitGaps: 0,
}
function observe(db, data) {
  if (!enabled() || !data.device_id) return
  let q = queues.get(db)
  if (!q) {
    q = { rows: [], retry: null, timer: null, inflight: false }
    queues.set(db, q)
  }
  if (q.rows.length >= 5000) {
    health.dropped++
    return
  }
  q.rows.push({
    id: randomUUID(),
    observed_at: new Date().toISOString(),
    receipt_bytes: 0,
    app_bytes: 0,
    ...data,
  })
  health.queued++
  if (!q.timer) {
    q.timer = setTimeout(() => {
      q.timer = null
      void flush(db)
    }, 1000)
    q.timer.unref()
  }
}
async function flush(db) {
  const q = queues.get(db)
  if (!q || q.inflight || (!q.rows.length && !q.retry)) return
  q.inflight = true
  const batch = q.retry || { rows: q.rows.splice(0, 100), attempts: 0 }
  q.retry = null
  batch.attempts++
  const rows = batch.rows
  let retained = false
  try {
    const { error } = await db.rpc('record_metric_observations', {
      p_rows: rows,
    })
    if (error) throw new Error('Observation persistence unavailable')
  } catch {
    health.failedFlushes++
    if (batch.attempts < 3) {
      q.retry = batch
      retained = true
    } else health.dropped += rows.length
  } finally {
    if (!retained) health.queued -= rows.length
    q.inflight = false
  }
  if ((q.rows.length || q.retry) && !q.timer) {
    q.timer = setTimeout(() => {
      q.timer = null
      void flush(db)
    }, 1000)
    q.timer.unref()
  }
}
module.exports = { enabled, health, observe, flush }

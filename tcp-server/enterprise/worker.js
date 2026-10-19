'use strict'
const { decryptSecret } = require('../auth'),
  { createHash } = require('node:crypto'),
  { sendEmail } = require('../observability/worker'),
  { heartbeat } = require('./health')
function appOrigin() {
  const u = new URL(process.env.STRUCT_APP_URL || 'https://usestruct.com')
  if (
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    (u.protocol !== 'https:' &&
      !(
        u.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(u.hostname)
      ))
  )
    throw Error('Application origin configuration invalid')
  return u.origin
}
async function tick(db, send = sendEmail) {
  const { data: job, error } = await db.rpc('enterprise_claim_mail')
  if (error) throw Error('Invitation queue unavailable')
  if (!job) return false
  let result
  try {
    const secret = decryptSecret(job.ciphertext)
    if (
      !/^[a-f0-9]{64}$/.test(secret) ||
      createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex') !==
        job.hash
    )
      throw Error()
    result = await send({
      id: job.id,
      to: job.to,
      severity: 'info',
      name: 'Invitation to a Struct workspace',
      state:
        'Sign in using the invited email address and verify it before accepting.',
      at: new Date().toISOString(),
      reason: `Accept this invitation: ${appOrigin()}/invite#token=${job.invitation_id}.${secret}\nThis link expires in seven days. If you did not expect it, ignore it.`,
    })
  } catch {
    result = { outcome: 'dead', category: 'configuration', status: null }
  }
  const done = await db.rpc('enterprise_finish_mail', {
    p_id: job.id,
    p_token: job.token,
    p_outcome: result.outcome,
    p_category: result.category,
    p_status: result.status,
    p_after: result.after ?? 0,
  })
  if (done.error)
    throw Error('Invitation completion unavailable; lease recovers')
  return true
}
function start(db, send) {
  let stopped = false,
    timer,
    active = Promise.resolve(),
    cycles = 0
  const metrics = { cycles: 0, errors: 0, lastSuccess: null },
    health = heartbeat(
      db,
      'enterprise',
      () =>
        !stopped &&
        !!metrics.lastSuccess &&
        Date.now() - Date.parse(metrics.lastSuccess) < 60000,
      () => metrics,
    )
  async function loop() {
    let delay = 1000
    try {
      if (await tick(db, send)) delay = 50
      metrics.cycles++
      metrics.lastSuccess = new Date().toISOString()
      if (++cycles % 3600 === 0) {
        const r = await db.rpc('enterprise_cleanup')
        if (r.error) throw Error()
      }
    } catch {
      metrics.errors++
      delay = 3000
    }
    if (!stopped)
      timer = setTimeout(() => {
        active = loop()
      }, delay)
  }
  active = loop()
  return {
    metrics,
    async stop() {
      stopped = true
      clearTimeout(timer)
      await active
      await health.stop()
    },
  }
}
module.exports = { appOrigin, tick, start }

'use strict'
const {
  classifyResponse,
  classifyError,
  retryAfter,
} = require('../delivery-policy')
async function sendEmail(job, fetcher = fetch) {
  const key = process.env.RESEND_API_KEY,
    from = process.env.STRUCT_ALERT_EMAIL_FROM
  if (!key || !from || /[\r\n]/.test(from))
    return { outcome: 'dead', category: 'configuration', status: null }
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'idempotency-key': `struct-alert-${job.id}`,
      },
      body: JSON.stringify({
        from,
        to: [job.to],
        subject: `[Struct ${job.severity}] ${job.name}`.slice(0, 200),
        text: `${job.name}\n${job.state}\n${job.reason}\nTriggered: ${job.at}\nOpen https://usestruct.com/dashboard/alerts to inspect or change email preferences. No device credentials are included.`,
      }),
    })
    // Acceptance is HTTP 2xx, not mailbox receipt. No response body is retained.
    const result = classifyResponse(response.status)
    await response.body?.cancel()
    return {
      ...result,
      status: response.status,
      after: retryAfter(response.headers.get('retry-after')),
    }
  } catch (error) {
    return { ...classifyError(error), status: null }
  }
}
async function tick(db, email = sendEmail) {
  const { data, error } = await db.rpc('observability_tick', { p_limit: 200 })
  if (error) throw new Error('Metrics/evaluation database unavailable')
  const claimed = await db.rpc('claim_alert_email')
  if (claimed.error) throw new Error('Notification claim unavailable')
  if (claimed.data) {
    const job = claimed.data,
      result = await email(job)
    const done = await db.rpc('finish_alert_email', {
      p_id: job.id,
      p_token: job.token,
      p_outcome: result.outcome,
      p_category: result.category,
      p_status: result.status,
      p_after: result.after ?? 0,
    })
    if (done.error)
      throw new Error('Notification completion unavailable; lease recovers')
  }
  return data
}
function start(db, email) {
  let stopped = false,
    timer,
    active = Promise.resolve(),
    cycles = 0
  const metrics = {
    cycles: 0,
    errors: 0,
    aggregated: 0,
    evaluated: 0,
    lastSuccess: null,
  }
  async function loop() {
    let delay = 1000
    try {
      const r = await tick(db, email)
      metrics.cycles++
      metrics.aggregated += r.aggregated
      metrics.evaluated += r.evaluated
      metrics.lastSuccess = new Date().toISOString()
      if (++cycles % 3600 === 0) {
        const { error } = await db.rpc('observability_cleanup')
        if (error) throw new Error()
      }
      if (r.aggregated === 200) delay = 20
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
    },
  }
}
module.exports = { sendEmail, tick, start }

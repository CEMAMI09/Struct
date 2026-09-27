const { postWebhook } = require('./safeWebhook')
const { signWebhookBody, matchesRoutingRule } = require('./webhooks')

async function deliver(supabase, job, post = postWebhook) {
  let outcome = 'retry', detail
  try {
    const { data: destination, error } = await supabase.from('destinations')
      .select('enabled,url,signing_secret').eq('id', job.destination_id).maybeSingle()
    if (error) throw new Error('Destination lookup unavailable')
    if (!destination?.enabled || destination.url !== job.destination_url) {
      outcome = 'dead'; detail = 'Destination removed, disabled or URL changed'
    } else if (!destination.signing_secret) {
      outcome = 'dead'; detail = 'Destination has no signing secret'
    } else if (!matchesRoutingRule(job.body.payload, job.routing_rule)) {
      outcome = 'skipped'; detail = 'Routing rule did not match'
    } else {
      const body = JSON.stringify(job.body)
      const response = await post(job.destination_url, body, {
        'content-type': 'application/json', 'x-struct-event': job.body.type,
        'x-struct-event-id': job.event_id, 'x-struct-delivery-id': job.id,
        'x-struct-signature': signWebhookBody(destination.signing_secret, body),
      }, AbortSignal.timeout(8000))
      outcome = response.ok ? 'delivered' : 'retry'
      detail = `HTTP ${response.status}`
    }
  } catch { detail = 'Network, timeout or destination validation failure' }
  const { data, error } = await supabase.rpc('finish_webhook_delivery', {
    p_id: job.id, p_token: job.lease_token, p_outcome: outcome, p_detail: detail,
  })
  if (error) throw new Error('Outbox completion failed; lease will recover')
  return data
}
async function tick(supabase, post) {
  const { data, error } = await supabase.rpc('claim_webhook_deliveries', { p_limit: 8 })
  if (error) throw new Error(`Outbox claim failed: ${error.message}`)
  const results = await Promise.allSettled((data || []).map(job => deliver(supabase, job, post)))
  for (const result of results) if (result.status === 'rejected') console.error(result.reason.message)
  return results
}
function startOutbox(supabase, {
  concurrency = Number(process.env.OUTBOX_CONCURRENCY || 8),
  idlePollMs = Number(process.env.OUTBOX_IDLE_POLL_MS || 1000),
  post = postWebhook,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64 ||
      !Number.isInteger(idlePollMs) || idlePollMs < 1) {
    throw new Error('Invalid outbox worker configuration')
  }
  let stopped = false, timer = null, running = false, lastCommandSweep = 0
  let currentPump = Promise.resolve()
  const active = new Set()

  function schedule(delay) {
    if (stopped || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      currentPump = pump()
    }, delay)
  }

  function launch(job) {
    const work = deliver(supabase, job, post)
      .catch(error => console.error(error.message))
      .finally(() => {
        active.delete(work)
        schedule(0)
      })
    active.add(work)
  }

  async function pump() {
    if (stopped || running || active.size >= concurrency) return
    running = true
    try {
      if (Date.now() - lastCommandSweep >= 30_000) {
        lastCommandSweep = Date.now()
        const { error } = await supabase.rpc('expire_pending_commands')
        if (error) console.error('Command expiry sweep failed')
      }
      const { data, error } = await supabase.rpc('claim_webhook_deliveries', {
        p_limit: concurrency - active.size,
      })
      if (error) throw new Error(`Outbox claim failed: ${error.message}`)
      for (const job of data || []) launch(job)
      if (active.size < concurrency) schedule(data?.length ? 0 : idlePollMs)
    } catch (error) {
      console.error(error.message)
      schedule(idlePollMs)
    } finally {
      running = false
    }
  }

  currentPump = pump()
  return async () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    await currentPump
    await Promise.allSettled([...active])
  }
}
module.exports = { deliver, tick, startOutbox }

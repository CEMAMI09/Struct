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
function startOutbox(supabase) {
  let stopped = false, timer, iterations = 0
  const run = async () => {
    try {
      if (iterations++ % 30 === 0) {
        const {error}=await supabase.rpc('expire_pending_commands')
        if(error)console.error('Command expiry sweep failed')
      }
      await tick(supabase)
    } catch (error) { console.error(error.message) }
    if (!stopped) timer = setTimeout(run, 1000)
  }
  void run()
  return () => { stopped = true; clearTimeout(timer) }
}
module.exports = { deliver, tick, startOutbox }

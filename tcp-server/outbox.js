const { postWebhook } = require('./safeWebhook')
const { signWebhookBody, matchesRoutingRule } = require('./webhooks')

const {
  retryAfter,
  classifyResponse,
  classifyError,
} = require('./delivery-policy')
async function deliver(
  supabase,
  job,
  post = postWebhook,
  { pipelineV2 = false, integrationsEnabled = false, integrationDependencies = {}, onOutcome = () => {} } = {},
) {
  const started = performance.now()
  let result = {
      outcome: 'retry',
      category: 'database',
      detail: 'Destination lookup unavailable',
    },
    status = null,
    after = null
  try {
    const { data: destination, error } = await supabase
      .from('destinations')
      .select(
        pipelineV2
          ? 'enabled,url,signing_secret,paused_at'
          : 'enabled,url,signing_secret',
      )
      .eq('id', job.destination_id)
      .maybeSingle()
    if (error)
      throw Object.assign(new Error('Destination lookup unavailable'), {
        code: 'DESTINATION_LOOKUP',
      })
    if (!destination?.enabled || destination.url !== job.destination_url) {
      result = {
        outcome: 'dead',
        category: 'configuration',
        detail: 'Destination removed, disabled or URL changed',
      }
    } else if (!destination.signing_secret && !job.integration_snapshot) {
      result = {
        outcome: 'dead',
        category: 'configuration',
        detail: 'Destination has no signing secret',
      }
    } else if (pipelineV2 && destination.paused_at) {
      result = {
        outcome: 'retry',
        category: 'paused',
        detail: 'Destination paused before dispatch',
      }
      after = 60
    } else if (
      !job.body ||
      (pipelineV2 && Date.parse(job.payload_expires_at) <= Date.now())
    ) {
      result = {
        outcome: 'dead',
        category: 'policy',
        detail: 'Recovery payload expired',
      }
    } else if (job.integration_snapshot) {
      if (!pipelineV2 || !integrationsEnabled) throw new Error("Integration dispatch disabled")
      result = await require("./integrations/dispatch").dispatchIntegration(supabase, job, {dependencies: integrationDependencies})
      status = Number.isInteger(result.httpStatus) && result.httpStatus >= 100 && result.httpStatus <= 599 ? result.httpStatus : null
      after = result.retryAfter ?? null
    } else if (!matchesRoutingRule(job.body.payload, job.routing_rule)) {
      result = {
        outcome: 'skipped',
        category: null,
        detail: 'Routing rule did not match',
      }
    } else {
      const body = JSON.stringify(job.body)
      const response = await post(
        job.destination_url,
        body,
        {
          'content-type': 'application/json',
          'x-struct-event': job.body.type,
          'x-struct-event-id': job.event_id,
          'x-struct-delivery-id': job.id,
          'x-struct-attempt': String(job.total_attempts ?? job.attempts ?? 1),
          'x-struct-signature': signWebhookBody(
            destination.signing_secret,
            body,
          ),
        },
        AbortSignal.timeout(8000),
      )
      status =
        Number.isInteger(response.status) &&
        response.status >= 100 &&
        response.status <= 599
          ? response.status
          : null
      result = pipelineV2
        ? classifyResponse(response.status)
        : {
            outcome: response.ok ? 'delivered' : 'retry',
            category: null,
            detail: `HTTP ${response.status}`,
          }
      after = retryAfter(response.retryAfter)
    }
  } catch (error) {
    result =
      error?.code === 'DESTINATION_LOOKUP'
        ? result
        : pipelineV2
          ? classifyError(error)
          : {
              outcome: 'retry',
              category: null,
              detail: 'Network, timeout or destination validation failure',
            }
  }
  const { data, error } = await supabase.rpc(
    job.integration_snapshot ? 'finish_integration_delivery' : pipelineV2 ? 'finish_webhook_delivery_v2' : 'finish_webhook_delivery',
    {
      p_id: job.id,
      p_token: job.lease_token,
      p_outcome: result.outcome,
      p_detail: result.detail,
      ...(job.integration_snapshot ? {p_provider_receipt:result.providerReceipt ?? null} : {}),
      ...(pipelineV2
        ? {
            p_http_status: status,
            p_error_category: result.category,
            p_latency_ms: Math.min(
              60000,
              Math.round(performance.now() - started),
            ),
            p_retry_after_seconds: after,
          }
        : {}),
    },
  )
  if (error) throw new Error('Outbox completion failed; lease will recover')
  onOutcome({
    outcome: result.outcome,
    accepted: data === true,
    latency_ms: Math.round(performance.now() - started),
  })
  return data
}
async function tick(supabase, post) {
  const { data, error } = await supabase.rpc('claim_webhook_deliveries', {
    p_limit: 8,
  })
  if (error) throw new Error(`Outbox claim failed: ${error.message}`)
  const results = await Promise.allSettled(
    (data || []).map((job) => deliver(supabase, job, post)),
  )
  for (const result of results)
    if (result.status === 'rejected') console.error(result.reason.message)
  return results
}
function startOutbox(
  supabase,
  {
    concurrency = Number(process.env.OUTBOX_CONCURRENCY || 8),
    idlePollMs = Number(process.env.OUTBOX_IDLE_POLL_MS || 1000),
    post = postWebhook,
    pipelineV2 = process.env.STRUCT_DELIVERY_PIPELINE_V2 === 'true',
    integrationsEnabled = process.env.STRUCT_INTEGRATIONS_ENABLED === 'true',
    integrationDependencies = {},
  } = {},
) {
  if (integrationsEnabled && !pipelineV2) throw new Error("Integrations require the durable delivery pipeline")
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 64 ||
    !Number.isInteger(idlePollMs) ||
    idlePollMs < 1
  ) {
    throw new Error('Invalid outbox worker configuration')
  }
  let stopped = false,
    timer = null,
    running = false,
    lastCommandSweep = 0
  let currentPump = Promise.resolve()
  const active = new Set()
  const stats = {
    started_at: new Date().toISOString(),
    claims: 0,
    completed: 0,
    delivered: 0,
    retry: 0,
    dead: 0,
    skipped: 0,
    stale_completions: 0,
    database_errors: 0,
    last_claim_at: null,
    last_database_error_at: null,
    latency_ms_total: 0,
  }

  function schedule(delay) {
    if (stopped || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      currentPump = pump()
    }, delay)
  }

  function launch(job) {
    const work = deliver(supabase, job, post, {
      pipelineV2,
      integrationsEnabled,
      integrationDependencies,
      onOutcome(result) {
        stats.completed++
        stats.latency_ms_total += result.latency_ms
        if (result.accepted) stats[result.outcome]++
        else stats.stale_completions++
      },
    })
      .catch((error) => {
        stats.database_errors++
        stats.last_database_error_at = new Date().toISOString()
        console.error(error.message)
      })
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
      const { data, error } = await supabase.rpc(
        integrationsEnabled ? 'claim_integration_deliveries' : pipelineV2 ? 'claim_webhook_deliveries_v2' : 'claim_webhook_deliveries',
        {
          p_limit: concurrency - active.size,
        },
      )
      if (error) throw new Error(`Outbox claim failed: ${error.message}`)
      stats.last_claim_at = new Date().toISOString()
      stats.claims += (data || []).length
      for (const job of data || []) launch(job)
      if (active.size < concurrency) schedule(data?.length ? 0 : idlePollMs)
    } catch (error) {
      stats.database_errors++
      stats.last_database_error_at = new Date().toISOString()
      console.error('Outbox claim unavailable')
      schedule(idlePollMs)
    } finally {
      running = false
    }
  }

  currentPump = pump()
  const stop = async () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    await currentPump
    await Promise.allSettled([...active])
  }
  stop.metrics = () => ({
    ...stats,
    healthy:
      !stopped &&
      stats.last_claim_at !== null &&
      Date.now() - Date.parse(stats.last_claim_at) <
        Math.max(30000, idlePollMs * 3),
    active: active.size,
    stopped,
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
  })
  return stop
}
module.exports = { deliver, tick, startOutbox }

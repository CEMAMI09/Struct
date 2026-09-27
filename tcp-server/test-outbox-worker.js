const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { startOutbox } = require('./outbox')

const jobs = Array.from({ length: 12 }, (_, index) => ({
  id: `delivery-${index}`,
  destination_id: 'destination',
  destination_url: 'https://example.com/events',
  event_id: `event-${index}`,
  lease_token: `lease-${index}`,
  routing_rule: null,
  body: { type: 'telemetry.received', payload: { value: index } },
}))
let deliveries = 0
let posting = 0
let peakPosting = 0
let claims = 0
const supabase = {
  from(table) {
    assert.equal(table, 'destinations')
    const query = {
      select() { return query },
      eq() { return query },
      async maybeSingle() {
        return { data: { enabled: true, url: 'https://example.com/events', signing_secret: 'test-secret' } }
      },
    }
    return query
  },
  async rpc(name, params) {
    if (name === 'expire_pending_commands') return { data: 0 }
    if (name === 'claim_webhook_deliveries') {
      assert(params.p_limit >= 1 && params.p_limit <= 4)
      claims++
      return { data: jobs.splice(0, params.p_limit) }
    }
    assert.equal(name, 'finish_webhook_delivery')
    assert.equal(params.p_outcome, 'delivered')
    deliveries++
    return { data: true }
  },
}

async function run() {
  const stop = startOutbox(supabase, {
    concurrency: 4,
    idlePollMs: 20,
    async post() {
      posting++
      peakPosting = Math.max(peakPosting, posting)
      try {
        await delay(25)
        return { ok: true, status: 200 }
      } finally {
        posting--
      }
    },
  })
  try {
    const deadline = Date.now() + 2000
    while (deliveries < 12 && Date.now() < deadline) await delay(10)
    assert.equal(deliveries, 12, 'worker must refill available slots without a one-second pause')
    assert.equal(peakPosting, 4)
    assert(claims >= 3)
  } finally {
    await stop()
  }
  console.log('outbox worker: bounded concurrency and continuous refill passed')
}

run().catch(error => { console.error(error); process.exitCode = 1 })

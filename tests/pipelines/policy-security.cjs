const assert = require('node:assert/strict'),
  dns = require('node:dns'),
  https = require('node:https'),
  { EventEmitter } = require('node:events')
const {
    retryAfter,
    classifyResponse,
    classifyError,
    validTransition,
  } = require('../../tcp-server/delivery-policy'),
  { postWebhook, publicLookup } = require('../../tcp-server/safeWebhook'),
  { Trace, persistTrace } = require('../../tcp-server/trace')
const fs = require('node:fs')
const { deliver } = require('../../tcp-server/outbox')
let checks = 0
function eq(actual, expected) {
  assert.deepEqual(actual, expected)
  checks++
}
;(async () => {
  for (const code of [200, 201, 204, 299])
    eq(classifyResponse(code).outcome, 'delivered')
  for (const code of [408, 429, 500, 503, 599])
    eq(classifyResponse(code).outcome, 'retry')
  for (const code of [300, 301, 302, 400, 401, 403, 404, 410, 422])
    eq(classifyResponse(code).outcome, 'dead')
  eq(retryAfter('120'), 120)
  eq(retryAfter('999999'), 3600)
  eq(retryAfter('invalid'), null)
  eq(
    retryAfter(
      'Sun, 01 Jan 2023 00:00:30 GMT',
      Date.parse('2023-01-01T00:00:00Z'),
    ),
    30,
  )
  eq(classifyError({ code: 'EAI_AGAIN' }).category, 'dns')
  eq(classifyError({ code: 'ENOTFOUND' }).outcome, 'retry')
  eq(classifyError({ name: 'TimeoutError' }).category, 'timeout')
  eq(classifyError({ code: 'ECONNREFUSED' }).category, 'network')
  eq(classifyError({ code: 'WEBHOOK_POLICY' }).outcome, 'dead')
  eq(classifyError({ code: 'CERT_HAS_EXPIRED' }).outcome, 'dead')
  eq(
    classifyError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }).category,
    'configuration',
  )
  eq(validTransition('pending', 'delivered'), false)
  eq(validTransition('sending', 'delivered'), true)
  eq(validTransition('dead', 'pending'), true)
  let completion
  const destination = {
    enabled: true,
    url: 'https://example.com/hook',
    signing_secret: 'local-test-secret',
  }
  const q = {
    select() {
      return q
    },
    eq() {
      return q
    },
    async maybeSingle() {
      return { data: destination }
    },
  }
  const db = {
    from() {
      return q
    },
    async rpc(name, args) {
      completion = { name, ...args }
      return { data: true }
    },
  }
  const job = {
    id: 'local-delivery',
    event_id: 'local-event',
    destination_id: 'local-destination',
    destination_url: destination.url,
    body: { id: 'local-event', type: 'telemetry.received', payload: {} },
    lease_token: 'local-token',
  }
  await deliver(db, job, async () => ({ status: 401, ok: false }))
  eq(completion.name, 'finish_webhook_delivery')
  eq(completion.p_outcome, 'retry')
  await deliver(db, job, async () => ({ status: 401, ok: false }), {
    pipelineV2: true,
  })
  eq(completion.name, 'finish_webhook_delivery_v2')
  eq(completion.p_outcome, 'dead')
  const originalLookup = dns.lookup,
    originalRequest = https.request
  try {
    dns.lookup = (host, options, callback) =>
      callback(null, [
        { address: '1.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ])
    await assert.rejects(
      new Promise((resolve, reject) =>
        publicLookup('example.com', {}, (e) => (e ? reject(e) : resolve())),
      ),
      (e) => e.code === 'WEBHOOK_POLICY',
    )
    checks++
    let lookups = 0,
      connections = 0,
      destroyed = 0
    dns.lookup = (host, options, callback) => {
      lookups++
      callback(null, [
        { address: lookups === 1 ? '1.1.1.1' : '10.0.0.1', family: 4 },
      ])
    }
    https.request = (url, options, callback) => {
      connections++
      eq(options.agent, false)
      eq(options.maxHeaderSize, 16384)
      const request = new EventEmitter()
      request.end = () => {
        options.lookup(url.hostname, {}, (error, address) => {
          if (error) return request.emit('error', error)
          eq(address, '1.1.1.1')
          callback({
            statusCode: 302,
            headers: {
              location: 'https://127.0.0.1/metadata',
              'retry-after': '60',
            },
            destroy() {
              destroyed++
            },
          })
        })
      }
      return request
    }
    const result = await postWebhook(
      'https://example.com/hook',
      '{}',
      {},
      AbortSignal.timeout(1000),
    )
    eq(result.status, 302)
    eq(result.retryAfter, '60')
    eq(connections, 1)
    eq(lookups, 1)
    eq(destroyed, 1)
    eq(classifyResponse(result.status).outcome, 'dead')
    // A second attempt sees the changed DNS answer and is rejected at connection lookup.
    await assert.rejects(
      postWebhook(
        'https://example.com/hook',
        '{}',
        {},
        AbortSignal.timeout(1000),
      ),
      (e) => e.code === 'WEBHOOK_POLICY',
    )
    checks++
    for (const target of [
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://169.254.169.254',
      'http://example.com',
      'https://[::ffff:127.0.0.1]',
    ]) {
      assert.throws(
        () => postWebhook(target, '{}', {}, AbortSignal.timeout(1000)),
        (e) => e.code === 'WEBHOOK_POLICY',
      )
      checks++
    }
    assert.throws(
      () =>
        postWebhook(
          'https://example.com',
          'x'.repeat(1048577),
          {},
          AbortSignal.timeout(1000),
        ),
      (e) => e.code === 'WEBHOOK_POLICY',
    )
    checks++
  } finally {
    dns.lookup = originalLookup
    https.request = originalRequest
  }
  let persisted = 0
  const database = {
      async rpc() {
        persisted++
        return { data: null }
      },
    },
    trace = new Trace('udp', 28)
  trace.device = {
    id: 'test',
    organization_id: 'test',
    debug_trace_until: new Date(Date.now() + 60000).toISOString(),
  }
  trace.begin('authentication')
  trace.fail()
  await persistTrace(database, trace)
  eq(persisted, 0)
  trace.begin('authentication')
  trace.finish()
  await persistTrace(database, trace)
  eq(persisted, 1)
  fs.writeFileSync(
    'docs/phase-3-4/evidence/policy-security.json',
    JSON.stringify(
      {
        passed: checks,
        transport:
          'DNS and HTTPS transport dependency injection; no public request sent',
        scenarios: [
          'HTTP retry classification',
          'Retry-After bounds',
          'state transitions',
          'mixed DNS answers',
          'DNS rebinding pinned lookup',
          'redirect not followed',
          'private and metadata targets',
          'oversized request',
          'response discarded',
          'unauthenticated trace suppressed',
        ],
      },
      null,
      2,
    ),
  )
  console.log(`PASS ${checks} retry/SSRF/trace-policy checks`)
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

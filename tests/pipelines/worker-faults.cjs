const assert = require('node:assert/strict'),
  http = require('node:http'),
  { once } = require('node:events'),
  { fork } = require('node:child_process'),
  { createHmac } = require('node:crypto'),
  fs = require('node:fs'),
  { fixture } = require('./fixture.cjs')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, timeout = 12000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await delay(10)
  }
  throw new Error('Test wait timed out')
}
;(async () => {
  const f = await fixture(),
    { db, adapter, scalar, ingest } = f
  const children = new Set(),
    observations = []
  let mode = 'success',
    holdFinish = false,
    finishWaiting = false,
    dbOutage = false,
    requests = 0
  const remoteSeen = new Map(),
    received = [],
    latencies = []
  let firstHookAt, lastHookAt
  const receiver = http.createServer((req, res) => {
    const parts = []
    req.on('data', (b) => parts.push(b))
    req.on('end', () => {
      const raw = Buffer.concat(parts),
        signature =
          'sha256=' +
          createHmac('sha256', 'test-signing-secret').update(raw).digest('hex')
      assert.equal(req.headers['x-struct-signature'], signature)
      const body = JSON.parse(raw)
      assert.equal(body.id, req.headers['x-struct-event-id'])
      requests++
      remoteSeen.set(body.id, (remoteSeen.get(body.id) || 0) + 1)
      received.push({
        event: body.id,
        delivery: req.headers['x-struct-delivery-id'],
        attempt: req.headers['x-struct-attempt'],
      })
      firstHookAt ??= performance.now()
      lastHookAt = performance.now()
      if (mode === '503') {
        res.writeHead(503).end()
        return
      }
      if (mode === '429') {
        res.writeHead(429, { 'Retry-After': '2' }).end()
        return
      }
      if (mode === '401') {
        res.writeHead(401).end()
        return
      }
      if (mode === 'slow') {
        setTimeout(() => res.writeHead(200).end(), 100)
        return
      }
      if (mode === 'timeout') return
      res.writeHead(204).end()
    })
  })
  const bridge = http.createServer((req, res) => {
    const parts = []
    req.on('data', (b) => parts.push(b))
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/destination') {
        const value = await adapter
          .from('destinations')
          .select('*')
          .eq('id', f.destination)
          .maybeSingle()
        return res.end(JSON.stringify(value))
      }
      const name = req.url.slice('/rpc/'.length),
        args = JSON.parse(Buffer.concat(parts).toString() || '{}')
      if (dbOutage)
        return res.end(
          JSON.stringify({ error: { message: 'Injected database outage' } }),
        )
      if (name === 'finish_webhook_delivery_v2' && holdFinish) {
        finishWaiting = true
        return
      }
      res.end(JSON.stringify(await adapter.rpc(name, args)))
    })
  })
  await Promise.all([
    new Promise((r) => receiver.listen(0, '127.0.0.1', r)),
    new Promise((r) => bridge.listen(0, '127.0.0.1', r)),
  ])
  const hookPort = receiver.address().port,
    apiPort = bridge.address().port
  const start = (point = '', targetPort = hookPort) => {
    const child = fork(require.resolve('./child-worker.cjs'), [], {
      env: {
        ...process.env,
        PIPELINE_TEST_API_PORT: String(apiPort),
        PIPELINE_TEST_HOOK_PORT: String(targetPort),
        PIPELINE_TEST_CRASH_POINT: point,
      },
      silent: true,
    })
    children.add(child)
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.once('exit', () => children.delete(child))
    return child
  }
  const stop = async (child) => {
    if (child.exitCode !== null) return
    const exit = once(child, 'exit')
    child.kill('SIGKILL')
    await exit
  }
  const clear = async () => {
    for (const child of [...children]) await stop(child)
    await db.exec(
      'delete from webhook_deliveries;delete from telemetry;delete from telemetry_events;update webhook_destination_runtime set next_dispatch_at=now()',
    )
    mode = 'success'
    holdFinish = false
    finishWaiting = false
    dbOutage = false
  }
  const ready = async () =>
    db.exec(
      'update webhook_deliveries set next_attempt_at=now();update webhook_destination_runtime set next_dispatch_at=now()',
    )
  const status = () => scalar('select status from webhook_deliveries limit 1')
  let seq = 0
  try {
    await db.exec('update delivery_pipeline_settings set enabled=true')
    const unused = http.createServer()
    await new Promise((r) => unused.listen(0, '127.0.0.1', r))
    const refusedPort = unused.address().port
    await new Promise((r) => unused.close(r))
    for (const scenario of ['503', '429', '401', 'dns', 'timeout', 'refused']) {
      await clear()
      await ingest(seq++)
      mode = scenario
      const before = requests
      const child = start(
        scenario === 'dns' ? 'dns' : '',
        scenario === 'refused' ? refusedPort : hookPort,
      )
      await until(
        async () =>
          ['pending', 'dead'].includes(await status()) &&
          (await scalar(
            'select count(*)::integer from webhook_attempts where completed_at is not null',
          )) > 0,
      )
      await stop(child)
      const row = await scalar(
        'select row_to_json(w) from webhook_deliveries w limit 1',
      )
      assert.equal(row.status, scenario === '401' ? 'dead' : 'pending')
      assert.equal(
        row.error_category,
        scenario === 'timeout'
          ? 'timeout'
          : scenario === 'dns'
            ? 'dns'
            : scenario === 'refused'
              ? 'network'
              : scenario === '401'
                ? 'http_permanent'
                : 'http_transient',
      )
      if (scenario === '429')
        assert(Date.parse(row.next_attempt_at) - Date.now() > 1000)
      observations.push({
        scenario,
        status: row.status,
        error_category: row.error_category,
        actual_http_requests: requests - before,
      })
      if (scenario !== '401') {
        mode = 'success'
        await ready()
        start()
        await until(async () => (await status()) === 'delivered')
        assert.equal(
          await scalar('select count(*)::integer from webhook_deliveries'),
          1,
        )
        observations.push({
          scenario: scenario + ' recovery',
          status: 'delivered',
        })
      }
    }
    // Crash after claim before dispatch; expire test lease instead of sleeping 60 seconds.
    await clear()
    await ingest(seq++)
    let child = start('before')
    await until(async () => (await status()) === 'sending')
    await stop(child)
    await db.exec(
      "update webhook_deliveries set lease_until=now()-interval '1 second'",
    )
    await ready()
    start()
    await until(async () => (await status()) === 'delivered')
    assert(
      (await scalar(
        "select count(*)::integer from webhook_attempts where outcome='unknown'",
      )) >= 1,
    )
    observations.push({
      scenario: 'killed after claim before send',
      status: 'recovered',
      lease_clock: 'advanced in disposable fixture',
    })
    // Kill during an actual in-flight HTTP request; receipt by the remote server
    // is not enough to establish successful completion at Struct.
    await clear()
    const inFlight = await ingest(seq++)
    mode = 'timeout'
    child = start()
    await until(() => remoteSeen.has(inFlight.eventIds[0]))
    await stop(child)
    mode = 'success'
    await db.exec(
      "update webhook_deliveries set lease_until=now()-interval '1 second'",
    )
    await ready()
    start()
    await until(async () => (await status()) === 'delivered')
    assert.equal(remoteSeen.get(inFlight.eventIds[0]), 2)
    observations.push({
      scenario: 'killed during HTTP request',
      status: 'recovered',
      remote_requests: 2,
      lease_clock: 'advanced in disposable fixture',
    })
    // Receiver succeeds, worker is killed before local database completion: duplicate is expected.
    await clear()
    const accepted = await ingest(seq++)
    holdFinish = true
    child = start()
    await until(() => finishWaiting)
    await stop(child)
    holdFinish = false
    await db.exec(
      "update webhook_deliveries set lease_until=now()-interval '1 second'",
    )
    await ready()
    start()
    await until(async () => (await status()) === 'delivered')
    assert.equal(remoteSeen.get(accepted.eventIds[0]), 2)
    const repeated = received.filter((r) => r.event === accepted.eventIds[0])
    assert.equal(repeated[0].delivery, repeated[1].delivery)
    observations.push({
      scenario: 'remote success then killed before completion',
      status: 'recovered',
      remote_requests: 2,
      stable_delivery_id: true,
    })
    // Database unavailable to workers: preserve work and recover after the bridge returns.
    await clear()
    await ingest(seq++)
    dbOutage = true
    start()
    await delay(100)
    assert.equal(await status(), 'pending')
    dbOutage = false
    await until(async () => (await status()) === 'delivered')
    observations.push({
      scenario: 'database RPC unavailable',
      status: 'recovered',
      fault: 'local RPC error injection, not database process termination',
    })
    // Two real child worker processes against one SQL backend; distinct claims and bounded endpoint capacity.
    await clear()
    for (let n = 0; n < 20; n++) {
      const begin = performance.now()
      await ingest(seq++)
      latencies.push(performance.now() - begin)
    }
    mode = 'slow'
    firstHookAt = null
    lastHookAt = null
    const base = requests,
      startAt = performance.now()
    const a = start(),
      b = start()
    await until(
      async () =>
        (await scalar(
          "select count(*)::integer from webhook_deliveries where status='delivered'",
        )) === 20,
      20000,
    )
    const elapsed = performance.now() - startAt
    const workerMetrics = await Promise.all(
      [a, b].map(
        (child) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              child.off('message', receive)
              reject(new Error('Missing worker metrics'))
            }, 3000)
            function receive(message) {
              if (message.stage !== 'metrics') return
              clearTimeout(timer)
              child.off('message', receive)
              resolve(message.metrics)
            }
            child.on('message', receive)
            child.send('metrics')
          }),
      ),
    )
    await stop(a)
    await stop(b)
    assert.equal(requests - base, 20)
    observations.push({
      scenario: 'two workers, 20 slow local HTTP deliveries',
      requests: 20,
      runtime_ms: elapsed,
      deliveries_per_second: 20000 / elapsed,
      distinct_events: new Set(received.slice(-20).map((r) => r.event)).size,
      sql_backend:
        'single PGlite backend; does not prove multi-backend row-lock contention',
    })
    const ordered = latencies.toSorted((a, b) => a - b)
    fs.writeFileSync(
      'docs/phase-3-4/evidence/worker-faults.json',
      JSON.stringify(
        {
          observations,
          gateway_host_processing: {
            samples: 20,
            median_ms: ordered[10],
            p95_ms: ordered[19],
          },
          remote_validation:
            'Actual loopback HTTP, raw-body HMAC and stable event/delivery identifiers verified; production HTTPS transport tested separately',
          memory: process.memoryUsage(),
          worker_resources: workerMetrics,
        },
        null,
        2,
      ),
    )
    console.log(
      'PASS worker fault/recovery, real HTTP HMAC, duplicate ambiguity, database outage and two-process local dispatch',
    )
  } finally {
    for (const child of [...children]) await stop(child)
    receiver.closeAllConnections()
    bridge.closeAllConnections()
    await Promise.all([
      new Promise((r) => receiver.close(r)),
      new Promise((r) => bridge.close(r)),
    ])
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

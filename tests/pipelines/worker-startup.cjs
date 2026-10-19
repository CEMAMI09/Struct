const assert = require('node:assert/strict')
const http = require('node:http')
const { fork } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
;(async () => {
  let enabled = false,
    claims = 0,
    hang = false
  const children = new Set()
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url.endsWith('/delivery_pipeline_health')) {
      if (hang) return
      res.end(JSON.stringify({ version: 2, enabled }))
    } else if (req.url.endsWith('/claim_webhook_deliveries_v2')) {
      claims++
      res.end('[]')
    } else res.end('null')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const reserved = http.createServer()
  await new Promise((resolve) => reserved.listen(0, '127.0.0.1', resolve))
  const healthPort = reserved.address().port
  await new Promise((resolve) => reserved.close(resolve))
  let checks = 0
  const check = (v, m) => {
    assert(v, m)
    checks++
  }
  const start = () => {
    const child = fork(require.resolve('../../tcp-server/worker'), [], {
      silent: true,
      env: {
        ...process.env,
        SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: 'local-test-key',
        STRUCT_DELIVERY_PIPELINE_V2: 'true',
        OUTBOX_HEALTH_PORT: String(healthPort),
        OUTBOX_IDLE_POLL_MS: '50',
      },
    })
    children.add(child)
    child.stdout.resume()
    child.stderr.resume()
    child.once('exit', () => children.delete(child))
    return child
  }
  try {
    let child = start()
    check(
      (await once(child, 'exit'))[0] === 1,
      'disabled database fails closed',
    )
    check(claims === 0, 'no claim before activation')
    enabled = true
    child = start()
    let health
    for (let n = 0; n < 100; n++) {
      try {
        health = await (
          await fetch(`http://127.0.0.1:${healthPort}/health`)
        ).json()
        if (health.healthy) break
      } catch {}
      await delay(20)
    }
    check(
      health?.healthy === true && health.pipelineV2 === true,
      'actual worker health reports active database polling',
    )
    check(claims > 0 && health.last_claim_at, 'actual worker RPC polling')
    check(
      (await fetch(`http://127.0.0.1:${healthPort}/anything`)).status === 404,
      'health listener exposes only health',
    )
    const exit = once(child, 'exit')
    child.kill('SIGTERM')
    await exit
    await assert.rejects(fetch(`http://127.0.0.1:${healthPort}/health`))
    checks++
    hang = true
    const began = performance.now()
    child = start()
    check((await once(child, 'exit'))[0] === 1, 'hung startup RPC aborts')
    const elapsed = performance.now() - began
    check(
      elapsed >= 9000 && elapsed < 15000,
      'database deadline is bounded at ten seconds',
    )
    fs.writeFileSync(
      'docs/phase-3-4/evidence/worker-startup.json',
      JSON.stringify(
        {
          checks,
          passed: checks,
          hung_rpc_exit_ms: elapsed,
          transport:
            'real worker process against isolated HTTP database fixture',
          limitations: [
            'fake Supabase REST responses; SQL and crypto tested separately',
          ],
        },
        null,
        2,
      ),
    )
    console.log(`PASS ${checks} worker startup/health/shutdown checks`)
  } finally {
    for (const child of children) child.kill('SIGKILL')
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

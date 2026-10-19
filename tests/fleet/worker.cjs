const assert = require('node:assert/strict'),
  http = require('node:http'),
  { fork } = require('node:child_process'),
  { once } = require('node:events')
process.env.TCP_CREDENTIAL_KEY = '34'.repeat(32)
const { credentials, start } = require('../../tcp-server/fleet/worker'),
  { decryptSecret } = require('../../tcp-server/auth')
async function run() {
  let checks = 0
  const check = (v, m) => {
      assert(v, m)
      checks++
    },
    roots = new Set(),
    bootstrap = new Set(),
    api = new Set()
  for (let i = 0; i < 2000; i++) {
    const c = credentials(),
      r = decryptSecret(c.root_encrypted),
      b = decryptSecret(c.bootstrap_encrypted),
      a = decryptSecret(c.api_encrypted)
    assert.match(r, /^[a-f0-9]{64}$/)
    assert(r !== b && r !== a && a !== b)
    roots.add(r)
    bootstrap.add(b)
    api.add(a)
  }
  check(
    roots.size === 2000 && bootstrap.size === 2000 && api.size === 2000,
    'actual decrypted random secrets independent and unique',
  )
  let release,
    called = false
  const worker = start({
    async rpc() {
      called = true
      await new Promise((r) => (release = r))
      return { data: null }
    },
  })
  check(called, 'poll starts outside browser')
  let stopped = false
  const stop = worker.stop().then(() => (stopped = true))
  await new Promise((r) => setTimeout(r, 10))
  check(!stopped, 'shutdown waits for in-flight work')
  release()
  await stop
  check(stopped, 'shutdown completes after work')
  let enabled = false,
    claims = 0
  const children = new Set(),
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url.startsWith('/rest/v1/fleet_settings'))
        res.end(JSON.stringify({ enabled }))
      else if (req.url.endsWith('/rpc/fleet_claim')) {
        claims++
        res.end('null')
      } else res.end('null')
    })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const spawn = (flag) => {
    const c = fork(require.resolve('../../tcp-server/fleet-worker'), [], {
      silent: true,
      env: {
        ...process.env,
        STRUCT_FLEET_ENABLED: flag,
        SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: 'local-disposable-key',
      },
    })
    children.add(c)
    c.stdout.resume()
    c.stderr.resume()
    c.once('exit', () => children.delete(c))
    return c
  }
  try {
    let c = spawn('false')
    check(
      (await once(c, 'exit'))[0] === 1 && claims === 0,
      'server flag disabled: no claim',
    )
    c = spawn('true')
    check(
      (await once(c, 'exit'))[0] === 1 && claims === 0,
      'database flag disabled: no claim',
    )
    enabled = true
    c = spawn('true')
    for (let i = 0; i < 100 && claims === 0; i++)
      await new Promise((r) => setTimeout(r, 20))
    check(claims > 0, 'real worker polls after explicit activation')
    const exit = once(c, 'exit')
    c.kill('SIGTERM')
    await exit
    const before = claims
    await new Promise((r) => setTimeout(r, 30))
    check(before === claims, 'worker stops polling after shutdown')
  } finally {
    for (const c of children) c.kill('SIGKILL')
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  }
  console.log(`fleet worker/credential: ${checks} assertions passed`)
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

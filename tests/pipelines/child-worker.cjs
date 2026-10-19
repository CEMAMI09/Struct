// Test-only child worker: real HTTP to loopback receiver, isolated database RPC bridge.
// This transport is injected only here; production postWebhook stays HTTPS/public-only.
const http = require('node:http'),
  { startOutbox } = require('../../tcp-server/outbox')
function request(port, path, body, headers = {}, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        signal,
      },
      (res) => {
        const parts = []
        res.on('data', (b) => parts.push(b))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            retryAfter: res.headers['retry-after'],
            body: Buffer.concat(parts).toString(),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}
const api = Number(process.env.PIPELINE_TEST_API_PORT),
  hook = Number(process.env.PIPELINE_TEST_HOOK_PORT)
if (!api || !hook) throw new Error('Test-only ports required')
const db = {
  from() {
    const q = {
      select() {
        return q
      },
      eq() {
        return q
      },
      async maybeSingle() {
        return JSON.parse((await request(api, '/destination', '{}')).body)
      },
    }
    return q
  },
  async rpc(name, args = {}) {
    return JSON.parse(
      (await request(api, '/rpc/' + name, JSON.stringify(args))).body,
    )
  },
}
const stop = startOutbox(db, {
  pipelineV2: true,
  concurrency: 4,
  idlePollMs: 20,
  async post(url, body, headers, signal) {
    process.send?.({ stage: 'before_post' })
    if (process.env.PIPELINE_TEST_CRASH_POINT === 'before')
      await new Promise(() => {})
    if (process.env.PIPELINE_TEST_CRASH_POINT === 'dns')
      throw Object.assign(new Error('Test DNS outage'), { code: 'EAI_AGAIN' })
    return request(hook, '/hook', body, headers, signal)
  },
})
process.on('message', async (message) => {
  if (message === 'metrics')
    process.send?.({ stage: 'metrics', metrics: stop.metrics() })
  if (message === 'stop') {
    await stop()
    process.send?.({ stage: 'stopped', metrics: stop.metrics() })
    process.disconnect()
  }
})

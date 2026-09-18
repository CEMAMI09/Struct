const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const { once } = require('node:events')
const { StructClient, buildFrame, verifyTelemetryReceipt } = require('../js/index.cjs')
const { buildTelemetryReceipt } = require('../js/protocol.cjs')
const secret = 'aa'.repeat(32), keyId = '0123456789abcdef'
async function scenario(handler, options) {
  const server = dgram.createSocket('udp4')
  server.bind(0, '127.0.0.1'); await once(server, 'listening')
  let count = 0, first
  server.on('message', (frame, peer) => {
    count++
    if (first) assert.deepEqual(frame, first, 'Retries must reuse exact bytes')
    first = frame; handler(server, frame, peer, count)
  })
  try {
    const client = new StructClient({ host: '127.0.0.1', port: server.address().port, keyId, apiSecret: secret })
    return await client.send(1, Buffer.from([42]), options)
  } finally { server.close() }
}
async function run() {
  const result = await scenario((s, frame, p, n) => {
    if (n === 1) return // Telemetry stored but first receipt lost.
    s.send(buildTelemetryReceipt(frame.subarray(-32), secret, true), p.port, p.address)
  }, { confirmed: true, retryMs: 1000, budgetMs: 3000 })
  assert.equal(result.status, 'committed'); assert.equal(result.attempts, 2); assert(result.duplicate)
  const timeout = await scenario((s, frame, p) => {
    s.send(buildTelemetryReceipt(frame.subarray(-32), 'wrong secret'), p.port, p.address)
  }, { confirmed: true, maxRetries: 0, budgetMs: 150 })
  assert.equal(timeout.status, 'unknown'); assert.equal(timeout.attempts, 1)
  const sent = await scenario(() => {}, {})
  assert.equal(sent.status, 'sent'); assert.equal(sent.attempts, 1)
  const frame = buildFrame({ keyId, apiSecret: secret, schemaVersion: 1, payload: Buffer.from([1]) })
  const receipt = buildTelemetryReceipt(frame.subarray(-32), secret)
  assert(verifyTelemetryReceipt(receipt, frame.subarray(-32), secret))
  assert(!verifyTelemetryReceipt(Buffer.concat([receipt, Buffer.from([0])]), frame.subarray(-32), secret))
  receipt[36] = 255; assert(!verifyTelemetryReceipt(receipt, frame.subarray(-32), secret))
  for (const bad of [0, 256, 1.5]) assert.throws(() => buildFrame({ keyId, apiSecret: secret, schemaVersion: bad, payload: Buffer.from([1]) }))
  console.log('Node UDP SDK: dropped receipt/retry, identical bytes, forged receipt, timeout and send-once passed')
}
run().catch(e => { console.error(e); process.exitCode = 1 })

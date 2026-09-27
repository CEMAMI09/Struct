const assert = require('node:assert/strict')
const net = require('node:net')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
process.env.TCP_CREDENTIAL_KEY = '11'.repeat(32)
const { createTcpServer } = require('./server')
const { startUdpServer } = require('./udp')
const { encryptSecret } = require('./auth')
const { buildFrame, StructClient } = require('../sdk/js/index.cjs')
const secret = 'a'.repeat(64), keyId = '0123456789abcdef'
const device = { id: 'device', name: 'Local transport test', key_id: keyId,
  api_secret_encrypted: encryptSecret(secret), schemas: { version: 1, schema_definition: [{ name: 'value', type: 'uint8' }] } }
const commits = [], seen = new Set()
let lookupGate = null
const supabase = {
  from(table) {
    const q = { select() { return q }, eq() { return q }, in() { return q }, or() { return q },
      maybeSingle: async () => {
        await delay(10) // Async lookup makes overlapping TCP handlers fail reliably.
        if (lookupGate) await lookupGate
        return { data: table === 'devices' ? device : table === 'schema_versions' ? device.schemas : null }
      },
      then(resolve) { return Promise.resolve({ data: [] }).then(resolve) },
    }; return q
  },
  async rpc(name, params) {
    if (name === 'claim_pending_downlinks') return { data: [] }
    assert.equal(name, 'ingest_device_telemetry')
    if (seen.has(params.p_nonce)) return { data: false }
    seen.add(params.p_nonce); commits.push(params.p_parsed_json.value); return { data: true }
  },
}
async function run() {
  const { server } = createTcpServer(supabase)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const socket = net.connect(server.address().port, '127.0.0.1')
  socket.on('error', () => {})
  try {
    await once(socket, 'connect')
    const frames = [1, 2, 3].map(value => buildFrame({ keyId, apiSecret: secret, schemaVersion: 1, payload: Buffer.from([value]) }))
    socket.write(frames[0].subarray(0, 12)); await delay(5)
    socket.write(Buffer.concat([frames[0].subarray(12), frames[1].subarray(0, 20)]))
    await delay(5); socket.write(Buffer.concat([frames[1].subarray(20), frames[2]]))
    for (let i = 0; i < 100 && commits.length < 3; i++) await delay(10)
    assert.deepEqual(commits, [1, 2, 3])
  } finally { socket.destroy(); await new Promise(resolve => server.close(resolve)) }
  const udp = startUdpServer(supabase, { port: 0 })
  await once(udp.socket, 'listening')
  try {
    const client = new StructClient({ host: '127.0.0.1', port: udp.socket.address().port, keyId, apiSecret: secret })
    const result = await client.send(1, Buffer.from([4]), { confirmed: true, maxRetries: 0, budgetMs: 1000 })
    assert.equal(result.status, 'committed')
    assert.deepEqual(commits, [1, 2, 3, 4])
  } finally { udp.socket.close() }

  // Keep one authenticated UDP frame in the database path. A second burst
  // datagram must be shed before it can create another unbounded async task.
  let releaseLookup
  lookupGate = new Promise(resolve => { releaseLookup = resolve })
  const limited = startUdpServer(supabase, { port: 0, maxInFlight: 1 })
  await once(limited.socket, 'listening')
  const sender = require('node:dgram').createSocket('udp4')
  try {
    const burst = [5, 6].map(value => buildFrame({ keyId, apiSecret: secret, schemaVersion: 1,
      payload: Buffer.from([value]), confirmed: true }))
    for (const frame of burst) sender.send(frame, limited.socket.address().port, '127.0.0.1')
    for (let i = 0; i < 100 && limited.getInFlight() !== 1; i++) await delay(5)
    assert.equal(limited.getInFlight(), 1)
    await delay(50)
    assert.equal(commits.length, 4)
    releaseLookup()
    for (let i = 0; i < 100 && limited.getInFlight() !== 0; i++) await delay(5)
    assert.equal(limited.getInFlight(), 0)
    assert.deepEqual(commits, [1, 2, 3, 4, 5])
  } finally {
    releaseLookup()
    lookupGate = null
    sender.close()
    limited.socket.close()
  }
  console.log('TCP fragments/coalescing and real UDP gateway storage receipt passed')
}
run().catch(e => { console.error(e); process.exitCode = 1 })

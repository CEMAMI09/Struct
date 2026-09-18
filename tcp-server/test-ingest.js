const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
process.env.TCP_CREDENTIAL_KEY = '11'.repeat(32)
const { encryptSecret } = require('./auth')
const { processFrame, getDeviceSecret, expectedFrameLength } = require('./ingest')
const { buildFrame, verifyTelemetryReceipt } = require('../sdk/js/index.cjs')
const { getProfileSecret } = require('./zeroTouch')

const secret = 'aa'.repeat(32), keyId = '0123456789abcdef'
const device = { id: 'test-device', name: 'test', key_id: keyId,
  api_secret_encrypted: encryptSecret(secret), encryption_enabled: false,
  schemas: { version: 1, schema_definition: [{ name: 'value', type: 'uint8' }] } }
let commits = 0, fail = false, webhookLookups = 0
const seen = new Map()
const supabase = {
  from(table) {
    const q = {
      select() { return q }, eq() { return q }, in() { return q },
      maybeSingle: async () => ({ data: table === 'devices' ? device : table === 'schema_versions' ? device.schemas : null, error: null }),
      then(resolve) { if (table === 'destinations') webhookLookups++; return Promise.resolve({ data: [], error: null }).then(resolve) },
    }
    return q
  },
  async rpc(name, params) {
    assert(['ingest_device_telemetry','ingest_queued_telemetry'].includes(name))
    if (name === 'ingest_queued_telemetry') {
      assert.equal(params.p_event_id, '\\x' + '07'.repeat(16))
      assert.equal(params.p_parsed_json.value, 99)
    }
    if (fail) return { error: { message: 'storage unavailable' } }
    const previous = seen.get(params.p_nonce)
    if (previous && previous !== params.p_frame_digest) return { error: { message: 'REPLAY_NONCE_CONFLICT' } }
    if (previous) return { data: false }
    seen.set(params.p_nonce, params.p_frame_digest); commits++
    return { data: true }
  },
}
async function run() {
  const frame = buildFrame({ keyId, apiSecret: secret, schemaVersion: 1, payload: Buffer.from([42]), confirmed: true })
  const ctx = { transport: 'udp', supabase }
  fail = true
  await assert.rejects(processFrame(frame, ctx), /storage unavailable/)
  fail = false
  const result = await processFrame(frame, ctx)
  assert.equal(result.parsed.value, 42)
  assert(verifyTelemetryReceipt(result.receipt, frame.subarray(-32), secret))
  const duplicate = await processFrame(frame, ctx)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.receipt[36], 1)
  assert.equal(commits, 1)
  const tampered = Buffer.from(frame); tampered[34] ^= 1
  await assert.rejects(processFrame(tampered, ctx), /authentication/)
  const trailing = buildFrame({ keyId, apiSecret: secret, schemaVersion: 1, payload: Buffer.from([1, 2]) })
  await assert.rejects(processFrame(trailing, ctx), /schema needs 1/)
  const skewed = buildFrame({ keyId, apiSecret: secret, schemaVersion: 1, payload: Buffer.from([1]), timestampSec: 1 })
  await assert.rejects(processFrame(skewed, ctx), /TIMESTAMP_SKEW/)
  await assert.rejects(processFrame(frame, { ...ctx, transport: 'tcp' }), /UDP telemetry only/)

  device.encryption_enabled = true; device.encryption_key = '22'.repeat(32)
  const encrypted = buildFrame({ keyId, apiSecret: secret, schemaVersion: 1, payload: Buffer.from([99]), encryptionKey: device.encryption_key, confirmed: true })
  assert.equal((await processFrame(encrypted, ctx)).parsed.value, 99)
  assert.equal(encrypted.length, 99)
  const queued = buildFrame({ keyId, apiSecret: secret, schemaVersion: 1, payload: Buffer.from([99]), encryptionKey: device.encryption_key, confirmed: true, eventId: Buffer.alloc(16,7) })
  assert.equal(queued[0],4)
  const queuedResult=await processFrame(queued,ctx)
  assert.equal(queuedResult.parsed.value,99)
  assert(verifyTelemetryReceipt(queuedResult.receipt,queued.subarray(-32),secret))
  assert.equal(await expectedFrameLength(supabase,{keyId,schemaVersion:1,protocol:4}),queued.length)

  const rotated = 'bb'.repeat(32)
  device.api_secret_encrypted = encryptSecret(rotated)
  assert.equal(getDeviceSecret(device), rotated)
  await assert.rejects(processFrame(encrypted, ctx), /authentication/)
  const profile = { id: 'p', fleet_secret_encrypted: encryptSecret(secret) }, cache = new Map()
  assert.equal(getProfileSecret(profile, cache), secret)
  profile.fleet_secret_encrypted = encryptSecret(rotated)
  assert.equal(getProfileSecret(profile, cache), rotated)
  const fleetProfile = { ...profile, name: 'Fleet', identity_field: 'value', schema_definition: device.schemas.schema_definition }
  const fleetDb = {
    from(table) {
      const q = { select() { return q }, eq() { return q },
        maybeSingle: async () => ({ data: table === 'device_profiles' ? fleetProfile : null, error: null }) }
      return q
    },
    async rpc(name) {
      assert.equal(name, 'zero_touch_register_device')
      return { data: device }
    },
  }
  const fleetFrame = buildFrame({ keyId, apiSecret: rotated, schemaVersion: 1, payload: Buffer.from([42]) })
  await assert.rejects(processFrame(fleetFrame, { ...ctx, supabase: fleetDb }), /Encrypted devices require/)
  console.log('ingest: storage failure, authenticated receipts, duplicate suppression, rotation, exact lengths and encryption passed')
}
run().catch(e => { console.error(e); process.exitCode = 1 })

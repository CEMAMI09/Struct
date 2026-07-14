/**
 * Replay / timestamp nonce tests.
 * Run: node test-replay.js
 */

const assert = require('assert')
const {
  TIMESTAMP_LEN,
  prependTimestamp,
  stripAndValidateTimestamp,
  rememberNonce,
  resetReplayCache,
} = require('./replay')
const { encryptPayload, decryptPayload } = require('./crypto')

resetReplayCache()

const packed = Buffer.from([1, 2, 3, 4, 5])
const now = 1_700_000_000
const withTs = prependTimestamp(packed, now)
assert.strictEqual(withTs.length, TIMESTAMP_LEN + packed.length)
assert.strictEqual(withTs.readUInt32LE(0), now)

const ok = stripAndValidateTimestamp(withTs, now, 60)
assert.deepStrictEqual(Buffer.from(ok.payload), packed)

assert.throws(() => stripAndValidateTimestamp(withTs, now + 120, 60))

const keyHex = 'bb'.repeat(32)
const enc = encryptPayload(withTs, keyHex)
const dec = decryptPayload(enc, keyHex)
const again = stripAndValidateTimestamp(dec, now, 60)
assert.deepStrictEqual(Buffer.from(again.payload), packed)

const nonce = enc.subarray(0, 12)
rememberNonce('device-a', nonce, 60)
assert.throws(() => rememberNonce('device-a', nonce, 60))
rememberNonce('device-b', nonce, 60) // different device OK

console.log('[test-replay] ok — timestamp + nonce replay checks')

/**
 * Quick self-test for ChaCha20 round-trip (no network).
 * Run: node test-crypto.js
 */

const assert = require('assert')
const { encryptPayload, decryptPayload, encryptedFrameLength } = require('./crypto')
const { encodePayload, parsePayload } = require('./parser')

const schema = [
  { name: 'temp', type: 'float32' },
  { name: 'humidity', type: 'float32' },
  { name: 'is_active', type: 'boolean' },
]

const keyHex = 'aa'.repeat(32)
const plain = encodePayload({ temp: 72.5, humidity: 45.2, is_active: true }, schema)
assert.strictEqual(plain.length, 9)

const enc = encryptPayload(plain, keyHex)
assert.strictEqual(enc.length, encryptedFrameLength(9))

const dec = decryptPayload(enc, keyHex)
const parsed = parsePayload(dec, schema)
assert.ok(Math.abs(parsed.temp - 72.5) < 1e-5)
assert.ok(Math.abs(parsed.humidity - 45.2) < 1e-5)
assert.strictEqual(parsed.is_active, true)

console.log('[test-crypto] ok — ChaCha20-Poly1305 round-trip')

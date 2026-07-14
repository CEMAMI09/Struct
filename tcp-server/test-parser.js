/**
 * Quick smoke test for the binary parser (no Supabase required).
 * Run: node test-parser.js
 */
const assert = require('assert')
const { parsePayload, encodePayload, schemaByteLength } = require('./parser')

const schema = [
  { name: 'temp', type: 'float32' },
  { name: 'humidity', type: 'float32' },
  { name: 'is_active', type: 'boolean' },
]

assert.strictEqual(schemaByteLength(schema), 9)

const values = { temp: 23.5, humidity: 61.25, is_active: true }
const buf = encodePayload(values, schema)
assert.strictEqual(buf.length, 9)

const parsed = parsePayload(buf, schema)
assert.ok(Math.abs(parsed.temp - 23.5) < 1e-5)
assert.ok(Math.abs(parsed.humidity - 61.25) < 1e-5)
assert.strictEqual(parsed.is_active, true)

// underrun
assert.throws(() => parsePayload(Buffer.alloc(4), schema))

console.log('parser ok:', parsed)

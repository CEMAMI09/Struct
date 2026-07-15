/**
 * Binary parser smoke tests (JS path).
 * Run: node test-parser.js
 */
const assert = require('assert')
const {
  parsePayload,
  encodePayload,
  schemaByteLength,
} = require('./parser')

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

// flags: 8 booleans → 1 byte
const flagsSchema = [
  { name: 'battery', type: 'uint8' },
  {
    name: 'status',
    type: 'flags',
    bits: [
      { name: 'motor_active', bit: 0 },
      { name: 'door_open', bit: 1 },
      { name: 'fault', bit: 7 },
    ],
  },
  { name: 'count', type: 'int32' },
]

assert.strictEqual(schemaByteLength(flagsSchema), 1 + 1 + 4)

const flagsValues = {
  battery: 91,
  status: { motor_active: true, door_open: false, fault: true },
  count: 42,
}
const flagsBuf = encodePayload(flagsValues, flagsSchema)
assert.strictEqual(flagsBuf.length, 6)
assert.strictEqual(flagsBuf[0], 91)
assert.strictEqual(flagsBuf[1], (1 << 0) | (1 << 7)) // motor + fault
assert.strictEqual(flagsBuf.readInt32LE(2), 42)

const flagsParsed = parsePayload(flagsBuf, flagsSchema)
assert.strictEqual(flagsParsed.battery, 91)
assert.deepStrictEqual(flagsParsed.status, {
  motor_active: true,
  door_open: false,
  fault: true,
})
assert.strictEqual(flagsParsed.count, 42)

assert.throws(() => parsePayload(Buffer.alloc(5), flagsSchema))

assert.throws(() =>
  schemaByteLength([
    {
      name: 'bad',
      type: 'flags',
      bits: [
        { name: 'a', bit: 0 },
        { name: 'b', bit: 0 },
      ],
    },
  ]),
)

console.log('parser ok:', { parsed, flagsParsed })

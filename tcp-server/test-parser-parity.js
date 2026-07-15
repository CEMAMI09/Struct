/**
 * Compare JS parser vs native napi-rs parser when the binding is available.
 * Always exercises the JS path; native is skipped with a note if not built.
 *
 * Run: node test-parser-parity.js
 */
const assert = require('assert')
const js = require('./parser')
const wrapped = require('./parser-native')

const fixtures = [
  {
    name: 'scalars',
    schema: [
      { name: 'temp', type: 'float32' },
      { name: 'humidity', type: 'float32' },
      { name: 'count', type: 'int32' },
      { name: 'battery', type: 'uint8' },
      { name: 'active', type: 'boolean' },
    ],
    values: {
      temp: 23.5,
      humidity: 61.25,
      count: -7,
      battery: 88,
      active: true,
    },
  },
  {
    name: 'flags-mixed',
    schema: [
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
    ],
    values: {
      battery: 91,
      status: { motor_active: true, door_open: false, fault: true },
      count: 42,
    },
  },
]

function nearlyEqualParsed(a, b, schema) {
  for (const field of schema) {
    if (field.type === 'float32') {
      assert.ok(Math.abs(a[field.name] - b[field.name]) < 1e-5, field.name)
    } else {
      assert.deepStrictEqual(a[field.name], b[field.name], field.name)
    }
  }
}

for (const fixture of fixtures) {
  const encoded = js.encodePayload(fixture.values, fixture.schema)
  const jsParsed = js.parsePayload(encoded, fixture.schema)
  assert.strictEqual(js.schemaByteLength(fixture.schema), encoded.length)

  // Round-trip via wrapper (may be native or JS)
  const wrappedEncoded = wrapped.encodePayload(fixture.values, fixture.schema)
  assert.deepStrictEqual(Buffer.from(wrappedEncoded), encoded)
  const wrappedParsed = wrapped.parsePayload(wrappedEncoded, fixture.schema)
  nearlyEqualParsed(jsParsed, wrappedParsed, fixture.schema)

  if (wrapped.hasNative) {
    const native = require('./native-parser')
    const nLen = native.schemaByteLength(JSON.stringify(fixture.schema))
    assert.strictEqual(nLen, encoded.length)
    const nParsed = native.parsePayload(encoded, JSON.stringify(fixture.schema))
    nearlyEqualParsed(jsParsed, nParsed, fixture.schema)
    const nEncoded = Buffer.from(
      native.encodePayload(
        JSON.stringify(fixture.values),
        JSON.stringify(fixture.schema),
      ),
    )
    assert.deepStrictEqual(nEncoded, encoded)
  }

  console.log(`parity ok: ${fixture.name}`)
}

console.log(
  wrapped.hasNative
    ? 'parser parity ok (native + js)'
    : 'parser parity ok (js only — native binding not built)',
)

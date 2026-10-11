import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { defaults as currentDefaults, makeField, shareConfig, restoreConfig, defaultRoi } from '../../shared/protocol-lab/config'
import { calculateRoi } from '../../shared/protocol-lab/roi'
import type { ResearchIndex, LabConfig, ProtocolId } from '../../shared/protocol-lab/types'
import { calculate } from './engine'
import { prepare, serialize, validateConfig } from './encoding'
const defaults = () => { const c=currentDefaults(); c.settings.precision='original'; return c }
const data = JSON.parse(
  gunzipSync(readFileSync(new URL('../assets/protocol-lab/index.json.gz', import.meta.url))).toString(),
) as ResearchIndex
const run = (config = defaults(), id: ProtocolId = 'struct') =>
  calculate(config, data, false).results.find((r) => r.id === id)!
describe('Protocol Lab real benchmark regression', () => {
  it('preserves all source IDs, profiles and schema cases', () => {
    expect(data.records).toHaveLength(data.coverage.total_configurations)
    expect(new Set(data.records.map((r) => r.id)).size).toBe(data.coverage.total_configurations)
    expect(data.schemas).toHaveLength(389)
  })
  it('matches original V2 payload and wire measurements', () => {
    const r = run()
    expect(r.payloadHex).toBe('0000bc410000754201')
    expect(r.metrics.payload?.value).toBe(9)
    expect(r.metrics.applicationUp?.value).toBe(34)
    expect(r.metrics.networkUp?.value).toBe(62)
    expect(r.references.length).toBeGreaterThan(0)
  })
  it('matches optimized SDK output and declared error', () => {
    const c = defaults()
    c.settings.precision = 'optimized'
    const r = run(c)
    expect(r.payloadHex).toBe('4f732c')
    expect(r.metrics.payload?.value).toBe(3)
    expect(r.metrics.applicationUp?.value).toBe(28)
    expect(r.metrics.networkUp?.value).toBe(56)
    expect(r.decoded).toMatchObject({ humidity: 61.3 })
  })
  it('adds real confirmed receipts and native batch framing', () => {
    const c = defaults()
    c.settings.delivery = 'confirmed'
    expect(run(c).metrics.exchange?.value).toBe(111)
    c.settings.batch = 100
    const r = run(c)
    expect(r.metrics.applicationUp?.value).toBe(926)
    expect(r.metrics.exchange?.value).toBe(1003)
    expect(r.metrics.effective?.value).toBe(10.03)
  })
  it('isolates plaintext lab mode from production V2 and keeps payload precision', () => {
    const c = defaults()
    c.settings.security = false
    c.settings.delivery = 'confirmed'
    const r = run(c)
    expect(r.metrics.applicationUp?.value).toBe(22)
    expect(r.metrics.exchange?.value).toBe(87)
    c.settings.batch = 2
    expect(run(c).status).toBe('calculated')
  })
  it('matches reference original serializers', () => {
    const c = defaults(),
      p = prepare(c.fields, c.settings)
    for (const [codec, size] of [
      ['protobuf', 12],
      ['json-compact', 47],
      ['json-standard', 52],
      ['json-array', 17],
      ['cbor-array', 8],
      ['cbor-canonical', 32],
      ['cbor-integer-keys', 11],
    ] as const)
      expect(serialize(codec, p, c.settings).length, codec).toBe(size)
  })
  it('matches CoAP/OSCORE profiles and IPv6 headers', () => {
    const c = defaults()
    expect(run(c, 'coap').metrics.applicationUp?.value).toBe(41)
    expect(run(c, 'coap').metrics.exchange?.value).toBe(122)
    c.settings.oscore = 'AES-CCM-16-64-128'
    expect(run(c, 'coap').metrics.networkUp?.value).toBe(61)
    c.settings.network = 'IPv6'
    expect(run(c, 'coap').metrics.networkUp?.value).toBe(81)
    expect(run(c).metrics.networkUp?.value).toBe(82)
  })
  it('matches actual MQTT plaintext and only uses matching TLS streams', () => {
    const c = defaults()
    c.settings.delivery = 'confirmed'
    let r = run(c, 'protobuf')
    expect(r.metrics.applicationUp?.value).toBe(30)
    expect(r.metrics.stream?.value).toBe(78)
    expect(r.metrics.networkUp?.evidence).toBe('estimated')
    c.fields.push(makeField('extra', 'float32', '1.5'))
    r = run(c, 'protobuf')
    expect(r.metrics.applicationUp?.value).toBe(35)
    expect(r.metrics.stream?.evidence).toBe('estimated')
  })
  it('uses LwM2M Send references without custom-schema fallback', () => {
    const c = defaults()
    expect(run(c, 'lwm2m').metrics.applicationUp?.value).toBe(96)
    expect(run(c, 'lwm2m').metrics.setup?.value).toBeNull()
    c.fields[0]!.value = '24'
    expect(run(c, 'lwm2m').status).toBe('estimated')
  })
})
describe('Schema, eligibility and ROI', () => {
  it('accounts for integer varint/tag thresholds', () => {
    const c = defaults()
    c.fields = [{ ...makeField('n', 'uint', '127'), width: 32 }]
    const size = () => serialize('protobuf', prepare(c.fields, c.settings), c.settings).length
    expect(size()).toBe(2)
    c.fields[0]!.value = '128'
    expect(size()).toBe(3)
    c.settings.protobufFieldStart = 16
    expect(size()).toBe(4)
    c.fields[0]!.value = '16384'
    expect(size()).toBe(5)
  })
  it('handles signed values, 64-bit extrema, Unicode, repeated and nested fields', () => {
    const c = defaults()
    c.fields = [
      { ...makeField('big', 'uint', '18446744073709551615'), width: 64 },
      makeField('text', 'string', '温度🌡️'),
      { ...makeField('readings', 'int', '[-1,0,128]'), repeated: true },
      { ...makeField('meta', 'nested', '{"label":"α"}'), fields: [makeField('label', 'string', 'α')] },
    ]
    validateConfig(c)
    for (const codec of ['protobuf', 'cbor-array', 'json-compact'])
      expect(serialize(codec, prepare(c.fields, c.settings), c.settings).length).toBeGreaterThan(0)
    expect(run(c).status).toBe('unsupported')
  })
  it('rejects invalid values, duplicate names and oversized inputs', () => {
    const c = defaults()
    c.fields[0]!.value = 'NaN'
    expect(() => run(c)).toThrow('finite')
    c.fields[0]!.value = '23.5'
    c.fields[1]!.name = 'temp'
    expect(() => validateConfig(c)).toThrow('distinct')
    c.fields[1]!.name = 'humidity'
    c.settings.batch = 101
    expect(() => validateConfig(c)).toThrow('Batch')
  })
  it('retains original values without invented precision ranges', () => {
    const c = defaults()
    c.settings.precision = 'optimized'
    delete c.fields[1]!.step
    const response = calculate(c, data, false)
    expect(response.warnings.join(' ')).toContain('retain their original')
    expect(response.results[0]!.decoded).toMatchObject({ humidity: 61.25 })
  })
  it('withholds incompatible percentages and missing-network costs', () => {
    const c = defaults(),
      response = calculate(c, data, false)
    expect(response.results.find((r) => r.id === 'protobuf')!.reduction).not.toBeNull()
    expect(response.results.find((r) => r.id === 'protobuf')!.comparison?.category).toBe('disclosed_differences')
    const roi = calculateRoi({ ...defaultRoi, enabled: true }, response.results)
    expect(roi.find((r) => r.id === 'protobuf')!.annualCost).toBeGreaterThan(0)
    c.settings.boundary='stream'
    expect(calculateRoi({...defaultRoi,enabled:true},calculate(c,data,false).results).find(r=>r.id==='protobuf')!.annualCost).toBeNull()
  })
  it('calculates decimal MB, cellular fraction, minimums and flat rates', () => {
    const response = calculate(defaults(), data, false)
    let rows = calculateRoi(
      { ...defaultRoi, devices: 10, eventsPerDay: 100, daysPerYear: 365, cellularPercent: 50, costPerMB: 2 },
      response.results,
    )
    const r = rows.find((r) => r.id === 'struct')!
    expect(r.annualMB).toBeCloseTo((10 * 100 * 365 * 0.5 * 62) / 1e6)
    expect(r.annualCost).toBeCloseTo(r.annualMB! * 2)
    rows = calculateRoi(
      { ...defaultRoi, devices: 10, billing: 'flat', minimumPerDevice: 1 },
      response.results,
    )
    expect(rows[0]!.annualCost).toBe(120)
    expect(rows[0]!.annualSavings).toBe(0)
  })
  it('restores a share configuration without credentials or rounding', () => {
    const c = defaults()
    expect(restoreConfig(shareConfig(c))).toEqual(c)
    expect(() => restoreConfig('broken')).toThrow()
  })
  it('returns unknown network totals when CoAP exceeds MTU', () => {
    const c = defaults()
    c.fields = [makeField('text', 'string', 'x'.repeat(2000))]
    expect(run(c, 'coap').metrics.networkUp?.value).toBeNull()
  })
  it('does not pretend custom loss is measured', () => {
    const c = defaults()
    c.settings.loss = 0.1
    expect(run(c).metrics.effective?.value).toBeNull()
  })
})
it('amortizes measured connection reuse without inventing TCP packets', () => {
  const c = defaults()
  c.settings.topic = 't'
  c.settings.includeSetup = true
  c.settings.connection = 'fresh'
  c.settings.boundary = 'stream'
  const first = run(c, 'protobuf')
  expect(first.metrics.stream?.value).toBeGreaterThan(1000)
  expect(first.metrics.stream?.evidence).toBe('measured')
  c.settings.connection = 'periodic'
  c.settings.messagesPerConnection = 10
  expect(run(c, 'protobuf').metrics.stream?.value).toBeLessThan(first.metrics.stream!.value!)
  c.settings.messagesPerConnection = 17
  expect(run(c, 'protobuf').metrics.stream?.value).toBeNull()
})
it('only ranks compatible uplinks and equivalent MQTT streams', () => {
  const c = defaults()
  c.settings.traffic = 'uplink'
  expect(run(c, 'coap').reduction).toBeCloseTo(((62 - 69) / 62) * 100)
  c.settings.oscore = 'AES-CCM-16-64-128'
  expect(run(c, 'coap').reduction).not.toBeNull()
  expect(run(c,'coap').comparison?.category).toBe('disclosed_differences')
  c.settings.boundary = 'stream'
  c.settings.baseline = 'json'
  expect(run(c, 'protobuf').reduction).toBeGreaterThan(0)
})
it('keeps nested precision transformations immutable and scaling failures isolated', () => {
  const c = defaults()
  c.fields = [
    {
      ...makeField('meta', 'nested', '{"temp":23.55}'),
      fields: [{ ...makeField('temp', 'float32', '23.55'), min: 0, max: 100, step: 0.1 }],
    },
  ]
  c.settings.precision = 'optimized'
  const original = JSON.stringify(c)
  expect(serialize('cbor-array', prepare(c.fields, c.settings), c.settings).length).toBeGreaterThan(0)
  expect(JSON.stringify(c)).toBe(original)
  c.settings.scaling = 'fields'
  const response = calculate(c, data)
  expect(response.scaling.at(-1)!.values.coap).toBeNull()
})
it('encodes absent optional fields, packed repetitions, fixed point, enum and bitsets', () => {
  const c = defaults()
  c.fields = [
    { ...makeField('state', 'enum', 'active'), labels: ['off', 'idle', 'active'] },
    { ...makeField('flags', 'bitset', '255'), width: 8 },
    { ...makeField('omitted', 'uint', '0'), optional: true, absent: true },
  ]
  expect(serialize('protobuf', prepare(c.fields, c.settings), c.settings).length).toBe(5)
  expect(serialize('cbor-array', prepare(c.fields, c.settings), c.settings).length).toBe(5)
  c.fields = [{ ...makeField('readings', 'uint', '[127,128,16384]'), repeated: true }]
  const packed = serialize('protobuf', prepare(c.fields, c.settings), c.settings).length
  c.settings.protobufPacked = false
  expect(serialize('protobuf', prepare(c.fields, c.settings), c.settings).length).toBeGreaterThan(packed)
})
it('models billing increments and an explicit measured baseline', () => {
  const rows = calculateRoi(
    {
      ...defaultRoi,
      devices: 1,
      eventsPerDay: 1,
      daysPerYear: 1,
      costPerMB: 1,
      incrementBytes: 100,
      measuredBytesPerEvent: 200,
    },
    calculate(defaults(), data, false).results,
  )
  expect(rows[0]!.annualCost).toBe(0.0001)
  expect(rows[0]!.annualSavings).toBe(0.0001)
  expect(rows[0]!.annualSavedMB).toBe(138 / 1e6)
})
it('rejects malformed share fields before rendering an editor', () => {
  expect(() =>
    restoreConfig(
      encodeURIComponent(JSON.stringify({ v: 1, config: { fields: [null], settings: defaults().settings } })),
    ),
  ).toThrow()
  const c = defaults()
  ;(c.settings as unknown as { visible: unknown }).visible = null
  expect(() => restoreConfig(shareConfig(c))).toThrow()
})

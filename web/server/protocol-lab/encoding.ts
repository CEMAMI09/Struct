import protobuf from 'protobufjs'
import cbor from 'cbor'
import * as packed from '../../../protocol/schema/bitpacked.cjs'
import type { PackedField } from '../../../protocol/schema/bitpacked.cjs'
import { generateSchemaCode } from '../../shared/schemaCodegen'
import type { SchemaField } from '../../app/types'
import type { LabConfig, LabField, LabSettings } from '../../shared/protocol-lab/types'

export interface Prepared {
  fields: LabField[]
  values: Record<string, unknown>
  source: Record<string, unknown>
  decoded: Record<string, unknown>
  warnings: string[]
}
const fail = (message: string): never => {
  throw Error(message)
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const types = [
  'bool',
  'int',
  'uint',
  'sint',
  'float16',
  'float32',
  'float64',
  'fixed',
  'enum',
  'bitset',
  'string',
  'timestamp',
  'bytes',
  'nested',
  'null',
]
export function validateConfig(input: unknown): asserts input is LabConfig {
  if (!input || typeof input !== 'object') fail('A configuration is required.')
  const c = input as LabConfig,
    s = c.settings
  if (!s || typeof s !== 'object' || !Array.isArray(c.fields) || !c.fields.length)
    fail('Add at least one field.')
  if (JSON.stringify(input).length > 64000) fail('Configuration exceeds 64 KB.')
  const choice = (value: unknown, values: unknown[], label: string) => {
    if (!values.includes(value)) fail(`Invalid ${label}.`)
  }
  const range = (value: unknown, min: number, max: number, label: string) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
      fail(`${label} must be ${min}..${max}.`)
  }
  choice(s.security, [true, false], 'security')
  choice(s.delivery, ['confirmed', 'unconfirmed'], 'delivery')
  choice(s.precision, ['original', 'optimized'], 'precision')
  choice(s.traffic, ['uplink', 'exchange'], 'traffic')
  choice(s.network, ['IPv4', 'IPv6'], 'network')
  choice(s.boundary, ['network', 'application', 'stream'], 'measurement boundary')
  choice(s.connection, ['persistent', 'fresh', 'periodic'], 'connection')
  choice(s.tls, ['TLSv1.2', 'TLSv1.3'], 'TLS')
  choice(s.mqttVersion, [4, 5], 'MQTT version')
  choice(s.qos, ['auto', 0, 1, 2], 'QoS')
  choice(s.oscore, ['AES-CCM-16-64-128', 'AES-CCM-16-128-128', 'ChaCha20/Poly1305'], 'OSCORE profile')
  choice(s.coapEncoding, ['cbor-array', 'cbor-canonical', 'json-compact', 'protobuf'], 'CoAP serialization')
  choice(s.jsonEncoding, ['json-compact', 'json-standard', 'json-array'], 'JSON layout')
  choice(s.cborEncoding, ['cbor-array', 'cbor-canonical', 'cbor-integer-keys'], 'CBOR layout')
  choice(s.jsonTransport, ['mqtt', 'https'], 'JSON transport')
  choice(s.lwm2mFormat, ['SENML_CBOR', 'SENML_JSON', 'TLV'], 'LwM2M format')
  choice(s.compression, ['off', 'gzip'], 'compression')
  range(s.batch, 1, 100, 'Batch')
  range(s.mtu, 576, 9000, 'MTU')
  range(s.coapToken, 0, 8, 'CoAP token')
  range(s.oscoreSequence, 0, 0xffffffff, 'OSCORE sequence')
  range(s.messagesPerConnection, 1, 1000000, 'Messages per connection')
  range(s.protobufFieldStart, 1, 1000, 'Protobuf first field number')
  if (
    typeof s.topic !== 'string' ||
    !s.topic.length ||
    Buffer.byteLength(s.topic) > 1024 ||
    /[\u0000+#]/.test(s.topic)
  )
    fail('Use a nonempty publish topic without wildcards, up to 1024 UTF-8 bytes.')
  if (typeof s.coapPath !== 'string' || !s.coapPath.startsWith('/') || Buffer.byteLength(s.coapPath) > 1024)
    fail('CoAP path must start with / and fit 1024 UTF-8 bytes.')
  for (const key of ['includeSetup', 'mqttProperties', 'protobufPacked'] as const)
    choice(s[key], [true, false], key)
  choice(s.loss, [0, 0.001, 0.01, 0.02, 0.05, 0.1], 'loss reference')
  choice(s.latency, [0, 10, 25, 50], 'latency reference')
  choice(s.scaling, ['batch', 'fields', 'bytes'], 'scaling axis')
  const ids = ['struct', 'protobuf', 'coap', 'lwm2m', 'json', 'cbor']
  choice(s.baseline, ids, 'baseline')
  if (
    !Array.isArray(s.visible) ||
    !s.visible.length ||
    s.visible.some((x) => !ids.includes(x)) ||
    new Set(s.visible).size !== s.visible.length
  )
    fail('Choose distinct supported protocols.')
  let count = 0
  function fields(list: LabField[], depth = 0) {
    if (depth > 3 || !Array.isArray(list) || !list.length) fail('Nested schemas require fields, to depth 3.')
    const names = new Set<string>()
    for (const f of list) {
      if (++count > 128) fail('At most 128 fields are supported.')
      if (
        !f ||
        typeof f.name !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(f.name) ||
        forbidden.has(f.name) ||
        names.has(f.name)
      )
        fail('Use distinct non-reserved field names, up to 64 characters.')
      names.add(f.name)
      choice(f.type, types, 'field type')
      range(f.width, 1, 64, 'Integer width')
      if (typeof f.value !== 'string' || f.value.length > 32768)
        fail(`${f.name}: sample value exceeds 32 KB.`)
      for (const key of ['optional', 'absent', 'repeated'] as const)
        choice(f[key], [true, false], `${f.name} ${key}`)
      if (f.absent && !f.optional) fail(`${f.name}: only optional fields can be absent.`)
      for (const key of ['min', 'max', 'step'] as const)
        if (f[key] !== undefined && (typeof f[key] !== 'number' || !Number.isFinite(f[key])))
          fail(`${f.name}: ${key} must be finite.`)
      if (f.type === 'nested') fields(f.fields ?? [], depth + 1)
      if (
        f.type === 'enum' &&
        (!Array.isArray(f.labels) ||
          f.labels.length < 2 ||
          f.labels.length > 256 ||
          f.labels.some((x) => typeof x !== 'string' || !x.length || x.length > 64) ||
          new Set(f.labels).size !== f.labels.length)
      )
        fail(`${f.name}: specify 2..256 distinct enum labels.`)
    }
  }
  fields(c.fields)
}
export function prepare(fields: LabField[], s: LabSettings, provided?: Record<string, unknown>): Prepared {
  const values: Record<string, unknown> = {},
    source: Record<string, unknown> = {},
    decoded: Record<string, unknown> = {},
    warnings: string[] = [],
    effective: LabField[] = []
  for (const f of fields) {
    const optimized =
      (s.precision === 'optimized' &&
        ['float32', 'float64'].includes(f.type) &&
        f.min !== undefined &&
        f.max !== undefined &&
        f.step !== undefined) ||
      f.type === 'fixed'
    const field = optimized ? { ...f, type: 'fixed' as const } : { ...f }
    effective.push(field)
    if (f.absent) continue
    const one = (raw: unknown): { value: unknown; encoded: unknown; decoded: unknown } => {
      const text = String(raw)
      if (f.type === 'nested') {
        const obj = typeof raw === 'object' ? raw : JSON.parse(text)
        if (!obj || typeof obj !== 'object' || Array.isArray(obj))
          fail(`${f.name}: nested sample must be an object.`)
        const child = prepare(f.fields ?? [], s, obj as Record<string, unknown>)
        warnings.push(...child.warnings)
        field.fields = child.fields
        return { value: child.values, encoded: child.source, decoded: child.decoded }
      }
      if (f.type === 'bool') {
        if (!['true', 'false'].includes(text)) fail(`${f.name}: use true or false.`)
        const v = text === 'true'
        return { value: v, encoded: v, decoded: v }
      }
      if (f.type === 'null') {
        if (text !== 'null') fail(`${f.name}: use null.`)
        return { value: null, encoded: null, decoded: null }
      }
      if (f.type === 'string') return { value: text, encoded: text, decoded: text }
      if (f.type === 'bytes') {
        const hex = text.replace(/\s/g, '')
        if (!/^(?:[a-fA-F0-9]{2})*$/.test(hex)) fail(`${f.name}: use complete hexadecimal byte pairs.`)
        const v = Buffer.from(hex, 'hex')
        return { value: v, encoded: v, decoded: v }
      }
      if (f.type === 'enum') {
        const code = f.labels!.indexOf(text)
        if (code < 0) fail(`${f.name}: select a declared enum label.`)
        return { value: text, encoded: code, decoded: text }
      }
      if (['int', 'uint', 'sint', 'timestamp', 'bitset'].includes(f.type)) {
        if (!/^-?\d+$/.test(text)) fail(`${f.name}: use an integer; 64-bit values may be decimal strings.`)
        const b = BigInt(text),
          signed = ['int', 'sint'].includes(f.type),
          bits = f.type === 'timestamp' ? 64 : f.width
        const min = signed ? -(BigInt(1) << BigInt(bits - 1)) : BigInt(0),
          max = (BigInt(1) << BigInt(signed ? bits - 1 : bits)) - BigInt(1)
        if (b < min || b > max) fail(`${f.name}: outside the declared ${bits}-bit range.`)
        const v = b > BigInt(Number.MAX_SAFE_INTEGER) || b < BigInt(Number.MIN_SAFE_INTEGER) ? b : Number(b)
        return { value: v, encoded: v, decoded: v }
      }
      if (!text.trim()) fail(`${f.name}: enter a numeric value.`)
      let v = Number(text)
      if (!Number.isFinite(v)) fail(`${f.name}: use a finite number.`)
      if (optimized) {
        if (
          field.min === undefined ||
          field.max === undefined ||
          field.step === undefined ||
          field.max <= field.min ||
          field.step <= 0 ||
          v < field.min ||
          v > field.max
        )
          fail(`${f.name}: specify a valid min/max/step and an in-range sample.`)
        const min = field.min!,
          max = field.max!,
          step = field.step!
        const levels = Math.floor((max - min) / step + 1e-7) + 1
        if (levels < 2 || levels > 2 ** 32) fail(`${f.name}: fixed-point range must fit 32 bits.`)
        const code = Math.floor((v - min) / step + 0.5 + 1e-7),
          restored = min + code * step
        if (code >= levels) fail(`${f.name}: rounded value exceeds the declared representable range.`)
        if (Math.abs(restored - v) > 1e-12)
          warnings.push(
            `${f.name}: ${v} becomes ${Number(restored.toPrecision(15))} (absolute error ${Number(Math.abs(restored - v).toPrecision(6))}).`,
          )
        return { value: v, encoded: code, decoded: Number(restored.toPrecision(15)) }
      }
      if (f.type === 'float32') {
        const rounded = Math.fround(v)
        if (!Number.isFinite(rounded)) fail(`${f.name}: float32 overflow.`)
        if (v !== rounded) warnings.push(`${f.name}: float32 represents ${v} as ${rounded}.`)
        v = rounded
      } else if (f.type === 'float16') {
        v = packed.float16Value(packed.float16Code(v))
        if (v !== Number(text)) warnings.push(`${f.name}: float16 becomes ${v}.`)
      }
      return { value: v, encoded: v, decoded: v }
    }
    const raw = provided ? provided[f.name] : f.value
    if (provided && !(f.name in provided)) {
      if (f.optional) continue
      fail(`${f.name}: missing nested value.`)
    }
    if (f.repeated) {
      const list = Array.isArray(raw) ? raw : JSON.parse(String(raw))
      if (!Array.isArray(list) || list.length > 1000)
        fail(`${f.name}: repeated sample must be an array of at most 1000 values.`)
      const entries = (list as unknown[]).map(one)
      values[f.name] = entries.map((x) => x.value)
      source[f.name] = entries.map((x) => x.encoded)
      decoded[f.name] = entries.map((x) => x.decoded)
    } else {
      const entry = one(raw)
      values[f.name] = entry.value
      source[f.name] = entry.encoded
      decoded[f.name] = entry.decoded
    }
  }
  return { fields: effective, values, source, decoded, warnings }
}
export function safeJson(value: unknown): unknown {
  if (typeof value === 'bigint') return { $integer: value.toString() }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return { $bytes: Buffer.from(value).toString('hex') }
  if (Array.isArray(value)) return value.map(safeJson)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeJson(v)]))
  return value
}
function verifyDecoded(actual: unknown, expected: unknown): void {
  if (Buffer.isBuffer(expected)) {
    if (!Buffer.from(actual as Uint8Array).equals(expected)) fail('Serializer byte-array round trip failed.')
    return
  }
  if (typeof expected === 'bigint') {
    if (String(actual) !== String(expected)) fail('Serializer 64-bit round trip failed.')
    return
  }
  if (typeof expected === 'number') {
    if (Number(actual) !== expected || (Object.is(expected, -0) && !Object.is(Number(actual), -0)))
      fail('Serializer numeric round trip failed.')
    return
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      fail('Serializer array round trip failed.')
    expected.forEach((v, i) => verifyDecoded((actual as unknown[])[i], v))
    return
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') fail('Serializer object round trip failed.')
    for (const [k, v] of Object.entries(expected)) verifyDecoded((actual as Record<string, unknown>)[k], v)
    return
  }
  if (actual !== expected) fail('Serializer value round trip failed.')
}
function restoreTagged(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreTagged)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.$bytes === 'string') return Buffer.from(obj.$bytes, 'hex')
    if (typeof obj.$integer === 'string') return BigInt(obj.$integer)
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, restoreTagged(v)]))
  }
  return value
}
class CborFloat {
  constructor(readonly value: number) {}
  encodeCBOR(encoder: { push: (value: Buffer) => boolean }) {
    let half: number | undefined
    try {
      half = packed.float16Code(this.value)
    } catch {
      /* use a wider representation */
    }
    if (half !== undefined && Object.is(packed.float16Value(half), this.value)) {
      const b = Buffer.alloc(3)
      b[0] = 0xf9
      b.writeUInt16BE(half, 1)
      return encoder.push(b)
    }
    if (Object.is(Math.fround(this.value), this.value)) {
      const b = Buffer.alloc(5)
      b[0] = 0xfa
      b.writeFloatBE(this.value, 1)
      return encoder.push(b)
    }
    const b = Buffer.alloc(9)
    b[0] = 0xfb
    b.writeDoubleBE(this.value, 1)
    return encoder.push(b)
  }
}
// Python benchmark JSON convention: declared floating values retain .0 and -0.0.
function jsonNumber(v: number, float: boolean) {
  if (!float) return JSON.stringify(v)
  if (Object.is(v, -0)) return '-0.0'
  let text = String(v)
  if ((Math.abs(v) >= 1e16 || (Math.abs(v) > 0 && Math.abs(v) < 1e-4)) && !text.includes('e'))
    text = v.toExponential()
  if (text.includes('e'))
    return text.replace(/e([+-]?)(\d+)$/, (_, sign, n) => `e${sign || '+'}${n.padStart(2, '0')}`)
  return text.includes('.') ? text : text + '.0'
}
function jsonEncode(
  value: unknown,
  fields: LabField[],
  standard: boolean,
  positional = false,
  batch = 1,
): Buffer {
  const comma = standard ? ', ' : ',',
    colon = standard ? ': ' : ':'
  function stringify(v: unknown, field?: LabField): string {
    if (typeof v === 'number')
      return jsonNumber(v, !!field && ['float16', 'float32', 'float64'].includes(field.type))
    if (typeof v === 'bigint' || Buffer.isBuffer(v)) return stringify(safeJson(v))
    if (Array.isArray(v)) return '[' + v.map((x) => stringify(x, field)).join(comma) + ']'
    if (v && typeof v === 'object')
      return (
        '{' +
        Object.entries(v)
          .map(
            ([k, x]) =>
              JSON.stringify(k) +
              colon +
              stringify(
                x,
                field?.fields?.find((f) => f.name === k),
              ),
          )
          .join(comma) +
        '}'
      )
    return JSON.stringify(v)
  }
  function reading(v: Record<string, unknown>) {
    return positional
      ? '[' + fields.map((f) => (f.name in v ? stringify(v[f.name], f) : 'null')).join(comma) + ']'
      : '{' +
          fields
            .filter((f) => f.name in v)
            .map((f) => JSON.stringify(f.name) + colon + stringify(v[f.name], f))
            .join(comma) +
          '}'
  }
  return Buffer.from(
    batch === 1
      ? reading(value as Record<string, unknown>)
      : '[' +
          Array.from({ length: batch }, () => reading(value as Record<string, unknown>)).join(comma) +
          ']',
  )
}
export function serialize(codec: string, p: Prepared, s: LabSettings): Buffer {
  let output: Buffer
  if (codec === 'protobuf') {
    const root = new protobuf.Root()
    function build(name: string, fields: LabField[]): protobuf.Type {
      const type = new protobuf.Type(name)
      fields.forEach((f, i) => {
        let scalar = (
          {
            bool: 'bool',
            int: f.width > 32 ? 'int64' : 'int32',
            uint: f.width > 32 ? 'uint64' : 'uint32',
            sint: f.width > 32 ? 'sint64' : 'sint32',
            bitset: f.width > 32 ? 'uint64' : 'uint32',
            timestamp: 'uint64',
            float16: 'float',
            float32: 'float',
            float64: 'double',
            fixed: 'uint32',
            enum: 'uint32',
            string: 'string',
            bytes: 'bytes',
          } as Record<string, string>
        )[f.type]
        if (f.type === 'nested') {
          const child = build('Nested' + i, f.fields ?? [])
          type.add(child)
          scalar = child.name
        }
        if (!scalar) fail('Protobuf null needs a separately declared schema; this mapping is unsupported.')
        type.add(
          new protobuf.Field(
            f.name,
            s.protobufFieldStart + i,
            scalar!,
            f.repeated ? 'repeated' : 'optional',
            undefined,
            { packed: s.protobufPacked },
          ),
        )
      })
      return type
    }
    const reading = build('Reading', p.fields)
    root.add(reading)
    const converted = (v: unknown): unknown =>
      typeof v === 'bigint'
        ? v.toString()
        : Buffer.isBuffer(v)
          ? v
          : Array.isArray(v)
            ? v.map(converted)
            : v && typeof v === 'object'
              ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, converted(x)]))
              : v
    let type = reading,
      value = converted(p.source)
    if (s.batch > 1) {
      type = new protobuf.Type('Batch').add(new protobuf.Field('readings', 1, 'Reading', 'repeated'))
      root.add(type)
      value = { readings: Array.from({ length: s.batch }, () => converted(p.source)) }
    }
    const message = type.fromObject(value as Record<string, unknown>)
    output = Buffer.from(type.encode(message).finish())
    const decoded = type.toObject(type.decode(output), { longs: String, bytes: Buffer, arrays: true })
    verifyDecoded(
      s.batch === 1 ? decoded : decoded.readings,
      s.batch === 1 ? p.source : Array.from({ length: s.batch }, () => p.source),
    )
  } else if (codec.startsWith('json')) {
    output = jsonEncode(p.source, p.fields, codec === 'json-standard', codec === 'json-array', s.batch)
    const decoded = restoreTagged(JSON.parse(output.toString()))
    const unlayout = (v: unknown) =>
      codec === 'json-array'
        ? Object.fromEntries(
            p.fields.flatMap((f, i) => (f.name in p.source ? [[f.name, (v as unknown[])[i]]] : [])),
          )
        : v
    verifyDecoded(
      s.batch === 1 ? unlayout(decoded) : (decoded as unknown[]).map(unlayout),
      s.batch === 1 ? p.source : Array.from({ length: s.batch }, () => p.source),
    )
  } else {
    function typed(fields: LabField[], value: Record<string, unknown>): Record<string, unknown> {
      return Object.fromEntries(
        fields
          .filter((f) => f.name in value)
          .map((f) => {
            const one = (v: unknown): unknown =>
              f.type === 'nested'
                ? typed(f.fields ?? [], v as Record<string, unknown>)
                : ['float16', 'float32', 'float64'].includes(f.type)
                  ? new CborFloat(Number(v))
                  : v
            return [f.name, f.repeated ? (value[f.name] as unknown[]).map(one) : one(value[f.name])]
          }),
      )
    }
    const values = typed(p.fields, p.source)
    const layout =
      codec === 'cbor-array'
        ? p.fields.map((f) => (f.name in values ? values[f.name] : undefined))
        : codec === 'cbor-integer-keys'
          ? new Map(
              p.fields.flatMap((f, i) =>
                f.name in values ? [[i, values[f.name]] as [number, unknown]] : [],
              ),
            )
          : values
    const options = { canonical: true, highWaterMark: 1048576 }
    output = cbor.encodeOne(s.batch === 1 ? layout : Array.from({ length: s.batch }, () => layout), options)
    const decoded = cbor.decodeFirstSync(output)
    const unlayout = (v: unknown) =>
      codec === 'cbor-array'
        ? Object.fromEntries(
            p.fields.flatMap((f, i) => (f.name in p.source ? [[f.name, (v as unknown[])[i]]] : [])),
          )
        : codec === 'cbor-integer-keys'
          ? Object.fromEntries([...(v as Map<number, unknown>)].map(([i, x]) => [p.fields[i]!.name, x]))
          : v
    verifyDecoded(
      s.batch === 1 ? unlayout(decoded) : decoded.map(unlayout),
      s.batch === 1 ? p.source : Array.from({ length: s.batch }, () => p.source),
    )
  }
  if (output.length > 65536) fail('Encoded message exceeds the calculator limit of 64 KiB.')
  return output
}
export function structEncode(p: Prepared, s: LabSettings): { payload: Buffer; sample: string } {
  if (p.fields.some((f) => f.optional || f.repeated || f.absent))
    fail('Struct codecs do not support optional or repeated fields.')
  const usePacked =
    s.precision === 'optimized' ||
    p.fields.some((f) => ['fixed', 'enum', 'bitset', 'float16'].includes(f.type))
  if (usePacked) {
    const definition = p.fields.map((f) => {
      if (
        ['string', 'bytes', 'nested', 'null', 'timestamp', 'float64', 'sint'].includes(f.type) ||
        (['int', 'uint', 'bitset'].includes(f.type) && f.width > 32)
      )
        fail(`Struct packed encoding does not support ${f.type}${f.width > 32 ? ' at this width' : ''}.`)
      return {
        name: f.name,
        type: f.type === 'bool' ? 'boolean' : f.type,
        width: f.width,
        min: f.min,
        max: f.max,
        precision: f.step,
        values: f.labels,
      } as PackedField
    })
    const payload = Buffer.from(packed.encodePayload(p.values, definition)),
      decoded = packed.decodePayload(payload, definition)
    for (const [name, value] of Object.entries(p.decoded)) {
      const actual = (decoded as Record<string, unknown>)[name]
      if (typeof value === 'number' && typeof actual === 'number') {
        if (Math.abs(actual - value) > Math.max(1, Math.abs(value)) * 1e-12)
          fail('Struct packed round trip failed.')
      } else verifyDecoded(actual, value)
    }
    return { payload, sample: packed.generateCHeader(definition, { slot: 1 }) }
  }
  const definition: SchemaField[] = p.fields.map((f) => {
    const type =
      f.type === 'bool'
        ? 'boolean'
        : f.type === 'int' && f.width === 32
          ? 'int32'
          : f.type === 'uint' && f.width === 8
            ? 'uint8'
            : f.type === 'float32'
              ? 'float32'
              : null
    if (!type)
      fail(
        `Struct original codec does not support ${f.type}${['int', 'uint'].includes(f.type) ? f.width : ''}; choose optimized packing when supported.`,
      )
    return { name: f.name, type } as SchemaField
  })
  const sample = generateSchemaCode(definition, 1, 'C').source
  const payload = Buffer.alloc(
    definition.reduce((n, f) => n + (['float32', 'int32'].includes(f.type) ? 4 : 1), 0),
  )
  let offset = 0
  for (const f of definition) {
    const v = p.values[f.name]
    if (f.type === 'float32') {
      payload.writeFloatLE(Number(v), offset)
      offset += 4
    } else if (f.type === 'int32') {
      payload.writeInt32LE(Number(v), offset)
      offset += 4
    } else payload[offset++] = f.type === 'boolean' ? (v ? 1 : 0) : Number(v)
  }
  return { payload, sample }
}

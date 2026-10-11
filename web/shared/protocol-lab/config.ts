import type { LabConfig, LabField, LabSettings, ResearchSchema, RoiInput } from './types'
export const protocolNames = {
  struct: 'Struct',
  protobuf: 'Protobuf',
  coap: 'CoAP',
  lwm2m: 'LwM2M',
  json: 'JSON',
  cbor: 'CBOR',
} as const
export const defaultSettings: LabSettings = {
  security: true,
  structGeneration: 'v2',
  delivery: 'unconfirmed',
  precision: 'optimized',
  batch: 1,
  traffic: 'exchange',
  network: 'IPv4',
  mtu: 1500,
  boundary: 'network',
  baseline: 'struct',
  visible: ['struct', 'protobuf', 'coap', 'lwm2m', 'json'],
  connection: 'persistent',
  messagesPerConnection: 100,
  includeSetup: false,
  tls: 'TLSv1.3',
  mqttVersion: 5,
  qos: 'auto',
  topic: 'telemetry/t',
  mqttProperties: false,
  coapSecurity: 'oscore',
  coapToken: 2,
  coapPath: '/t',
  oscore: 'ChaCha20/Poly1305',
  oscoreSequence: 40,
  coapEncoding: 'cbor-array',
  jsonEncoding: 'json-compact',
  cborEncoding: 'cbor-array',
  jsonTransport: 'mqtt',
  protobufFieldStart: 1,
  protobufPacked: true,
  lwm2mFormat: 'SENML_CBOR',
  compression: 'off',
  loss: 0,
  latency: 0,
  scaling: 'batch',
}
export const makeField = (name = 'value', type: LabField['type'] = 'float32', value = '0'): LabField => ({
  id: name,
  name,
  type,
  value,
  width: 32,
  optional: false,
  absent: false,
  repeated: false,
  ...(type === 'string' || type === 'bytes' ? {maxBytes:64} : {}),
})
export function defaults(): LabConfig {
  return {
    settings: structuredClone(defaultSettings),
    fields: [
      { ...makeField('temp', 'float32', '23.5'), min: -40, max: 125, step: 0.1 },
      { ...makeField('humidity', 'float32', '61.25'), min: 0, max: 100, step: 0.1 },
      makeField('is_active', 'bool', 'true'),
    ],
  }
}
export const defaultRoi: RoiInput = {
  enabled: false,
  devices: 1000,
  eventsPerDay: 1440,
  daysPerYear: 365,
  cellularPercent: 100,
  costPerMB: 0.03,
  currency: 'USD',
  billing: 'metered',
  minimumPerDevice: 0,
  incrementBytes: 0,
  baseline: 'struct',
  measuredBytesPerEvent: null,
  measuredMBPerMonth: null,
}
export function presetFields(schema: ResearchSchema): LabField[] {
  const convert = (
    fields: Record<string, unknown>[],
    values: Record<string, unknown>,
    prefix = 'preset',
  ): LabField[] =>
    fields.map((f, i) => {
      const raw = String(f.type),
        match = /^(u?int)(8|16|32|64)$/.exec(raw)
      const type = (
        match
          ? match[1] === 'uint'
            ? 'uint'
            : 'int'
          : raw === 'nullable'
            ? 'null'
            : raw === 'uintvar'
              ? 'uint'
              : raw === 'intvar'
                ? 'int'
                : raw === 'sintvar'
                  ? 'sint'
                  : raw
      ) as LabField['type']
      const v = values[String(f.name)],
        tagged = v as { $bytes?: string; $integer?: string } | undefined
      const value =
        tagged?.$bytes ??
        tagged?.$integer ??
        (v === undefined
          ? '0'
          : Object.is(v, -0)
            ? '-0'
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v))
      return {
        ...makeField(String(f.name), type, value),
        id: `${prefix}-${i}`,
        width: match ? Number(match[2]) : raw.endsWith('var') ? 64 : typeof f.bits === 'number' ? f.bits : 32,
        optional: !!f.optional,
        absent: !!f.optional && !(String(f.name) in values),
        repeated: !!f.repeated,
        min: f.min as number | undefined,
        max: f.max as number | undefined,
        step: f.precision as number | undefined,
        labels: f.values as string[] | undefined,
        fields:
          raw === 'nested'
            ? convert(f.fields as Record<string, unknown>[], v as Record<string, unknown>, `${prefix}-${i}`)
            : undefined,
      }
    })
  return convert(schema.fields, schema.values)
}
export function shareConfig(config: LabConfig): string {
  const text = JSON.stringify({ v: 1, config })
  if (text.length > 24000) throw Error('Configuration is too large for a share URL; export JSON instead.')
  return encodeURIComponent(text)
}
export function assertEditableFields(value: unknown): asserts value is LabField[] {
  let count = 0
  const ids = new Set<string>()
  const check = (list: unknown, depth = 0) => {
    if (!Array.isArray(list) || !list.length || depth > 3)
      throw Error('Use a nonempty field array, with nested depth at most 3.')
    for (const f of list) {
      if (
        ++count > 128 ||
        !f ||
        typeof f !== 'object' ||
        typeof f.id !== 'string' ||
        !f.id.length ||
        ids.has(f.id) ||
        typeof f.name !== 'string' ||
        typeof f.type !== 'string' ||
        typeof f.value !== 'string' ||
        typeof f.width !== 'number' ||
        !Number.isInteger(f.width) ||
        ['optional', 'absent', 'repeated'].some((k) => typeof f[k] !== 'boolean')
      )
        throw Error(
          'Each field needs a unique id, name, type, string value, integer width, and boolean presence/repetition flags. Maximum 128 fields.',
        )
      ids.add(f.id)
      if (
        f.type === 'enum' &&
        (!Array.isArray(f.labels) || f.labels.some((x: unknown) => typeof x !== 'string'))
      )
        throw Error('Enum labels must be strings.')
      if (f.type === 'nested') check(f.fields, depth + 1)
    }
  }
  check(value)
}
export function restoreConfig(value: string): LabConfig {
  if (value.length > 80000) throw Error('Share URL exceeds the size limit.')
  const parsed = JSON.parse(decodeURIComponent(value))
  if (parsed.v !== 1 || !Array.isArray(parsed.config?.fields) || !parsed.config.settings)
    throw Error('Unsupported share configuration.')
  assertEditableFields(parsed.config.fields)
  const settings = { ...defaultSettings, ...parsed.config.settings }
  for (const [key, expected] of Object.entries(defaultSettings)) {
    const actual = settings[key]
    if (
      Array.isArray(expected)
        ? !Array.isArray(actual) || actual.some((x: unknown) => typeof x !== 'string')
        : typeof actual !== typeof expected && key !== 'qos'
    )
      throw Error('Invalid shared settings.')
  }
  return { fields: parsed.config.fields, settings }
}

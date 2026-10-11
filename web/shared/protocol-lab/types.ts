export type ProtocolId = 'struct' | 'protobuf' | 'coap' | 'lwm2m' | 'json' | 'cbor'
export type FieldType =
  | 'bool'
  | 'int'
  | 'uint'
  | 'sint'
  | 'float16'
  | 'float32'
  | 'float64'
  | 'fixed'
  | 'enum'
  | 'bitset'
  | 'string'
  | 'timestamp'
  | 'bytes'
  | 'nested'
  | 'null'
export interface LabField {
  id: string
  name: string
  type: FieldType
  value: string
  width: number
  optional: boolean
  absent: boolean
  repeated: boolean
  min?: number
  max?: number
  step?: number
  maxBytes?: number
  labels?: string[]
  fields?: LabField[]
}
export interface LabSettings {
  security: boolean
  structGeneration: 'v2' | 'v1'
  delivery: 'unconfirmed' | 'confirmed'
  precision: 'original' | 'optimized'
  batch: number
  traffic: 'uplink' | 'exchange'
  network: 'IPv4' | 'IPv6'
  mtu: number
  boundary: 'network' | 'application' | 'stream'
  baseline: ProtocolId
  visible: ProtocolId[]
  connection: 'persistent' | 'fresh' | 'periodic'
  messagesPerConnection: number
  includeSetup: boolean
  tls: 'TLSv1.2' | 'TLSv1.3'
  mqttVersion: 4 | 5
  qos: 'auto' | 0 | 1 | 2
  topic: string
  mqttProperties: boolean
  coapSecurity: 'oscore' | 'dtls-ccm8' | 'dtls-ccm16'
  coapToken: number
  coapPath: string
  oscore: 'AES-CCM-16-64-128' | 'AES-CCM-16-128-128' | 'ChaCha20/Poly1305'
  oscoreSequence: number
  coapEncoding: 'cbor-array' | 'cbor-canonical' | 'json-compact' | 'protobuf'
  jsonEncoding: 'json-compact' | 'json-standard' | 'json-array'
  cborEncoding: 'cbor-array' | 'cbor-canonical' | 'cbor-integer-keys'
  jsonTransport: 'mqtt' | 'https'
  protobufFieldStart: number
  protobufPacked: boolean
  lwm2mFormat: 'SENML_CBOR' | 'SENML_JSON' | 'TLV'
  compression: 'off' | 'gzip'
  loss: number
  latency: number
  scaling: 'batch' | 'fields' | 'bytes'
}
export interface LabConfig {
  fields: LabField[]
  settings: LabSettings
}
export type Evidence = 'measured' | 'calculated' | 'estimated' | 'unsupported' | 'not_tested' | 'failed'
export interface LabMetric {
  value: number | null
  evidence: Evidence
  note: string
}
export interface ByteParts {
  payload: number
  framing: number | null
  security: number | null
  transport: number | null
  network: number | null
  response: number | null
  connection: number | null
}
export interface LabResult {
  id: ProtocolId
  name: string
  profile: string
  status: Evidence
  reason?: string
  metrics: Record<string, LabMetric>
  parts: ByteParts
  payloadHex?: string
  decoded?: unknown
  notes: string[]
  sources: string[]
  references: string[]
  implementation: string
  security: {
    encryption: string
    authentication: string
    integrity: string
    replay: string
    forwardSecrecy: string
    keys: string
    tagBytes: number
  }
  reliability: { guarantee: string; retries: string; deduplication: string; identity: string }
  eligibilityKey: string
  boundary: string
  reduction: number | null
  difference: number | null
  comparison?: { category: 'direct'|'disclosed_differences'|'incomplete'|'unsupported'; data: string; security: string; delivery: string; measurement: string; warnings: string[] }
  notComparable: string[]
  sample?: string
  sampleLanguage?: string
}
export interface LabResponse {
  results: LabResult[]
  warnings: string[]
  schemaHash: string
  scaling: { x: number; values: Partial<Record<ProtocolId, number | null>> }[]
}
export interface RoiInput {
  enabled: boolean
  devices: number
  eventsPerDay: number
  daysPerYear: number
  cellularPercent: number
  costPerMB: number
  currency: string
  billing: 'metered' | 'flat'
  minimumPerDevice: number
  incrementBytes: number
  baseline: ProtocolId
  measuredBytesPerEvent: number | null
  measuredMBPerMonth: number | null
}
export interface RoiRow {
  id: ProtocolId
  bytesPerEvent: number | null
  monthlyMB: number | null
  annualMB: number | null
  currentAnnualMB: number | null
  annualSavedMB: number | null
  monthlyCost: number | null
  annualCost: number | null
  annualSavings: number | null
  reduction: number | null
  note: string
}
export interface ResearchProfile {
  protocol_category: string
  protocol_stack: string
  implementation: string
  implementation_version: string | null
  specification_version: string | null
  precision_policy: string
  security_enabled: boolean
  security_configuration: string | null
  delivery_mode: string
  batch_size: number
  network_type: string
  connection_mode: string
  protocol_specific_settings: Record<string, unknown>
  source_references: string[]
  comparison_scope: string
  measurement_provenance: Record<string, string>
  delivery_guarantee?: string
}
export interface ResearchRecord {
  id: string
  schema: string
  profile: number
  test_status: string
  [key: string]: unknown
}
export interface ResearchSchema {
  id: string
  fields: Record<string, unknown>[]
  values: Record<string, unknown>
  precision_policy: string
  family: string
}
export interface ResearchIndex {
  version: string
  profiles: ResearchProfile[]
  records: ResearchRecord[]
  schemas: ResearchSchema[]
  coverage: { total_configurations: number }
}
export interface LabMetadata {
  version: string
  coverage: { total_configurations: number; unique_schema_value_cases: number }
  sources: { id: string; url: string; title?: string }[]
  presets: ResearchSchema[]
  researchUrl: string
}

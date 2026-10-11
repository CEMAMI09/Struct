import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { defaults as currentDefaults, presetFields } from '../../shared/protocol-lab/config'
import type { ResearchIndex } from '../../shared/protocol-lab/types'
import { prepare, serialize } from './encoding'
const defaults = () => { const c=currentDefaults(); c.settings.precision='original'; return c }
const data = JSON.parse(
  gunzipSync(readFileSync(new URL('../assets/protocol-lab/index.json.gz', import.meta.url))).toString(),
) as ResearchIndex
const codecs = new Set([
  'protobuf',
  'json-compact',
  'json-standard',
  'json-array',
  'cbor-array',
  'cbor-canonical',
  'cbor-integer-keys',
])
it('cross-validates serializer lengths against the independent Python archive', () => {
  let checked = 0
  const mismatches: string[] = []
  for (const row of data.records) {
    const profile = data.profiles[row.profile]!
    if (!codecs.has(profile.protocol_stack) || row.test_status !== 'passed' || profile.batch_size !== 1)
      continue
    const schema = data.schemas.find((s) => s.id === row.schema)!
    const c = defaults()
    c.fields = presetFields(schema)
    c.settings.batch = profile.batch_size
    c.settings.protobufFieldStart = Number(profile.protocol_specific_settings.field_start ?? 1)
    c.settings.protobufPacked = profile.protocol_specific_settings.packed !== false
    try {
      const bytes = serialize(profile.protocol_stack, prepare(c.fields, c.settings), c.settings).length
      if (bytes !== row.serialized_payload_bytes)
        mismatches.push(
          `${row.schema}/${profile.protocol_stack}/${row.id}: ${bytes} != ${row.serialized_payload_bytes}`,
        )
      checked++
    } catch (e) {
      mismatches.push(`${row.schema}/${profile.protocol_stack}: ${e}`)
    }
  }
  expect(mismatches).toEqual([])
  expect(checked).toBeGreaterThan(2500)
})
import { calculate } from './engine'
it('cross-validates original CoAP and OSCORE datagrams across archived options', () => {
  let checked = 0
  for (const row of data.records) {
    const p = data.profiles[row.profile]!
    if (
      row.schema !== 'esp32-original' ||
      row.test_status !== 'passed' ||
      !['cbor-array', 'cbor-canonical', 'json-compact', 'protobuf'].some(
        (codec) => p.protocol_stack === `${codec}+CoAP+${p.security_enabled ? 'OSCORE+UDP' : 'UDP'}`,
      )
    )
      continue
    const c = defaults()
    c.settings.security = p.security_enabled
    c.settings.delivery = p.delivery_mode.startsWith('CON') ? 'confirmed' : 'unconfirmed'
    c.settings.network = p.network_type as 'IPv4' | 'IPv6'
    c.settings.batch = p.batch_size
    c.settings.coapEncoding = p.protocol_category as typeof c.settings.coapEncoding
    c.settings.coapToken = Number(p.protocol_specific_settings.token_length)
    c.settings.coapPath = '/' + (p.protocol_specific_settings.uri_path as string[]).join('/')
    if (p.security_enabled) c.settings.oscore = p.security_configuration as typeof c.settings.oscore
    c.settings.oscoreSequence = Number(row.oscore_sender_sequence ?? 0)
    const result = calculate(c, data, false).results.find((r) => r.id === 'coap')!
    expect(result.metrics.applicationUp?.value, row.id).toBe(row.application_uplink_bytes)
    expect(result.metrics.applicationDown?.value, row.id).toBe(row.application_downlink_bytes)
    checked++
  }
  expect(checked).toBeGreaterThan(100)
}, 30000)
it('cross-validates MQTT publish and acknowledgment framing against archived packets', () => {
  let checked = 0
  for (const row of data.records) {
    const p = data.profiles[row.profile]!
    if (
      row.schema !== 'esp32-original' ||
      row.test_status !== 'passed' ||
      p.connection_mode !== 'persistent' ||
      !['protobuf', 'json-compact', 'json-array', 'cbor-array', 'cbor-canonical'].some(
        (codec) => p.protocol_stack === `${codec}+MQTT+${p.security_enabled ? 'TLS' : 'TCP'}`,
      )
    )
      continue
    const c = defaults()
    c.settings.security = p.security_enabled
    c.settings.network = p.network_type as 'IPv4' | 'IPv6'
    c.settings.batch = p.batch_size
    c.settings.mqttVersion = p.protocol_specific_settings.mqtt_version as 4 | 5
    c.settings.qos = p.protocol_specific_settings.qos as 0 | 1 | 2
    c.settings.topic = String(p.protocol_specific_settings.topic)
    c.settings.mqttProperties = p.protocol_specific_settings.properties === true
    if (p.security_enabled) c.settings.tls = p.security_configuration as typeof c.settings.tls
    const codec = p.protocol_stack.split('+')[0]!
    const id = codec === 'protobuf' ? 'protobuf' : codec.startsWith('json') ? 'json' : 'cbor'
    if (id === 'json') c.settings.jsonEncoding = codec as typeof c.settings.jsonEncoding
    if (id === 'cbor') c.settings.cborEncoding = codec as typeof c.settings.cborEncoding
    const result = calculate(c, data, false).results.find((r) => r.id === id)!
    expect(result.metrics.applicationUp?.value, row.id).toBe(row.application_uplink_bytes)
    expect(result.metrics.applicationDown?.value, row.id).toBe(row.application_downlink_bytes)
    checked++
  }
  expect(checked).toBeGreaterThan(100)
}, 30000)

import * as plaintext from '../../../protocol/schema/lab-plaintext.cjs'
import * as legacyWire from '../../../sdk/js/protocol.cjs'
import { modelTcp } from './network-model'
import { encodeSenml } from './lwm2m'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import * as coap from 'coap-packet'
import * as wire from '../../../sdk/js/secure-v2.cjs'
import { protocolNames } from '../../shared/protocol-lab/config'
import type {
  Evidence,
  LabConfig,
  LabMetric,
  LabResponse,
  LabResult,
  LabSettings,
  ProtocolId,
  ResearchIndex,
  ResearchRecord,
  ResearchProfile,
} from '../../shared/protocol-lab/types'
import { prepare, safeJson, serialize, structEncode, validateConfig, type Prepared } from './encoding'

const metric = (value: number | null, note: string, evidence: Evidence = 'calculated'): LabMetric => ({
  value,
  note,
  evidence: value === null ? 'not_tested' : evidence,
})
const unknown = (note: string) => metric(null, note)
const number = (r: ResearchRecord, key: string): number | null =>
  typeof r[key] === 'number' ? (r[key] as number) : null
const cryptoRoot = Buffer.alloc(32) // Ephemeral illustration only, never used for network or device credentials.
function result(id: ProtocolId, s: LabSettings): LabResult {
  return {
    id,
    name: protocolNames[id],
    profile: '',
    status: 'calculated',
    metrics: {},
    parts: {
      payload: 0,
      framing: null,
      security: null,
      transport: null,
      network: null,
      response: null,
      connection: null,
    },
    notes: [],
    sources: [],
    references: [],
    implementation: '',
    security: {
      encryption: 'None',
      authentication: 'None',
      integrity: 'None',
      replay: 'None',
      forwardSecrecy: 'No',
      keys: 'None',
      tagBytes: 0,
    },
    reliability: { guarantee: '', retries: '', deduplication: '', identity: 'none' },
    eligibilityKey: '',
    boundary: s.boundary,
    reduction: null,
    difference: null,
    notComparable: [],
  }
}
function udp(
  r: LabResult,
  s: LabSettings,
  up: number,
  down: number,
  upCount: number,
  downCount: number,
  evidence: Evidence = 'calculated',
) {
  const ip = s.network === 'IPv4' ? 20 : 40
  r.metrics.applicationUp = metric(
    up,
    'Complete device UDP datagram content, summed across the batch.',
    evidence,
  )
  r.metrics.applicationDown = metric(down, 'Server UDP datagram contents, summed across the batch.', evidence)
  r.metrics.transport = metric(upCount * 8, '8-byte UDP header per uplink datagram.')
  r.metrics.network = metric(
    upCount * ip,
    `${ip}-byte ${s.network} base header per uplink datagram; options/extensions excluded.`,
  )
  r.metrics.networkUp = metric(
    up + upCount * (ip + 8),
    'Datagram contents plus specification-calculated UDP/IP headers; no packet capture.',
  )
  r.metrics.networkDown = metric(
    down + downCount * (ip + 8),
    'Includes minimum UDP/IP headers for actual response policy.',
  )
  r.metrics.exchange = metric(
    up + down + (upCount + downCount) * (ip + 8),
    'Steady-state bidirectional UDP/IP total under no-fragmentation assumptions.',
  )
  r.metrics.stream = unknown('UDP has no TCP/TLS byte-stream measurement.')
  r.parts.transport = upCount * 8
  r.parts.network = upCount * ip
  r.parts.response = s.traffic === 'exchange' ? down + downCount * (ip + 8) : 0
  r.metrics.setup = metric(
    0,
    'No per-message handshake in the preprovisioned, steady-state profile; enrollment/registration costs are separate.',
  )
  r.metrics.maintenance = unknown('Lifecycle maintenance is not included in this steady-state result.')
}
function finalMetric(r: LabResult, s: LabSettings) {
  let selected =
    s.boundary === 'network'
      ? s.traffic === 'uplink'
        ? r.metrics.networkUp
        : r.metrics.exchange
      : s.boundary === 'application'
        ? s.traffic === 'uplink'
          ? r.metrics.applicationUp
          : r.metrics.applicationExchange
        : r.metrics.stream
  if (
    !r.metrics.applicationExchange &&
    r.metrics.applicationUp?.value !== null &&
    r.metrics.applicationDown?.value !== null
  )
    r.metrics.applicationExchange = metric(
      (r.metrics.applicationUp?.value ?? 0) + (r.metrics.applicationDown?.value ?? 0),
      'Application protocol bytes only; transport/IP headers excluded.',
      r.metrics.applicationUp?.evidence,
    )
  if (s.boundary === 'application') {
    selected = ['protobuf','json','cbor'].includes(r.id) ? r.metrics.stream : s.traffic === 'uplink' ? r.metrics.applicationUp : r.metrics.applicationExchange
    if (['protobuf','json','cbor'].includes(r.id) && selected) selected = {...selected,note:'Normalized application wire boundary includes TLS records when enabled, just as UDP datagrams include their own security. TCP/IP excluded. '+selected.note}
  }
  if (s.boundary === 'network' && selected?.value !== null && selected) selected.evidence = 'estimated'
  r.metrics.selected = selected ?? unknown('Selected measurement boundary unavailable for this stack.')
  r.metrics.effective = metric(
    r.metrics.selected.value === null ? null : r.metrics.selected.value / s.batch,
    `${s.traffic === 'uplink' ? 'Uplink' : 'Full exchange'} at the selected ${s.boundary} boundary, divided by ${s.batch} logical reading(s).`,
    r.metrics.selected.evidence,
  )
  if (
    r.metrics.networkUp?.value !== null &&
    r.metrics.networkUp?.value !== undefined &&
    r.metrics.networkUp.value > s.mtu
  ) {
    // Struct can split a batch into small frames; its caller checks each frame separately.
    if (['coap', 'lwm2m'].includes(r.id)) {
      r.notes.push(
        `Message exceeds the selected ${s.mtu}-byte MTU. IP fragmentation/blockwise traffic is not inferred.`,
      )
      for (const key of ['networkUp', 'networkDown', 'exchange'])
        r.metrics[key] = unknown('MTU exceeded; real fragmentation/blockwise accounting is required.')
      if (s.boundary === 'network') {
        r.metrics.selected = unknown('MTU exceeded.')
        r.metrics.effective = unknown('MTU exceeded.')
      }
    }
  }
  r.metrics.framing = metric(
    r.parts.framing,
    'Protocol framing, excluding encoded batch data and authentication tags.',
  )
  r.metrics.security = metric(
    r.parts.security,
    'Uplink cryptographic record/tag overhead; TLS record bytes are included in the normalized application wire boundary, while raw MQTT/HTTP rows exclude TLS. Key provisioning is separate.',
  )
  r.eligibilityKey=[s.boundary,s.traffic,s.precision,s.batch,s.connection,s.includeSetup].join('|')

}
function referenceSchema(config: LabConfig, data: ResearchIndex): string | undefined {
  const p = prepare(config.fields, config.settings)
  const candidate = data.schemas.find((c) => {
    if (c.fields.length !== p.fields.length) return false
    return c.fields.every((f, i) => {
      const field = p.fields[i]!,
        type = String(f.type)
      const sameType =
        type === field.type ||
        (type === `uint${field.width}` && field.type === 'uint') ||
        (type === `int${field.width}` && field.type === 'int')
      return (
        f.name === field.name &&
        sameType &&
        (JSON.stringify(c.values[field.name]) === JSON.stringify(safeJson(p.values[field.name])) || type==='float32' && Math.fround(Number(c.values[field.name])) === p.values[field.name]) &&
        (!['int','uint','sint','bitset'].includes(field.type) || typeof f.width !== 'number' || f.width===field.width) &&
        (!('precision' in f) || (f.precision === field.step && f.min === field.min && f.max === field.max)) &&
        !!f.repeated === field.repeated &&
        !!f.optional === field.optional
      )
    })
  })
  return candidate?.id
}
function find(
  data: ResearchIndex,
  schema: string | undefined,
  predicate: (p: ResearchProfile, r: ResearchRecord) => boolean,
): ResearchRecord | undefined {
  if (!schema) return undefined
  return data.records.find(
    (r) => r.schema === schema && r.test_status === 'passed' && predicate(data.profiles[r.profile]!, r),
  )
}
function struct(r: LabResult, p: Prepared, s: LabSettings) {
  const { payload, sample, encoding } = structEncode(p, s)
  r.sample = sample
  r.sampleLanguage = 'Generated C payload header'
  const confirmed = s.delivery === 'confirmed'
  const legacy = s.structGeneration === 'v1'
  if (legacy && s.batch > 1) throw Error('Legacy V1 has no native batching. Choose V2.')
  let lengths: number[]
  const batches = s.batch === 1 ? [payload] : wire.splitBatch(Array.from({length:s.batch},()=>payload))
  if (legacy) {
    if(encoding !== 'legacy-le-v1') throw Error('Legacy V1 requires the original legacy schema codec. Packed/new field types are Secure V2 capabilities, not a legacy transport option.')
    if (s.security) throw Error('Legacy authenticated plaintext is not encrypted. Disable encryption to inspect V1; Secure V2 is the encrypted production profile.')
    const frame = legacyWire.buildTelemetryFrame({keyId:'labdevice0000001',schemaVersion:1,timestampSec:1,nonce:Buffer.alloc(12),payload,secret:'local-lab-only',confirmed})
    lengths=[frame.length];r.parts.payload=payload.length;r.parts.framing=legacyWire.V2_HEADER_LEN;r.parts.security=legacyWire.HMAC_LEN
    r.profile='Legacy V1 / authenticated plaintext'
    r.security.authentication='Per-device HMAC secret';r.security.integrity='HMAC-SHA256';r.security.tagBytes=32
    r.reliability={guarantee:confirmed?'legacy receipt':'best effort',retries:'Legacy SDK retry policy',deduplication:'Legacy replay policy',identity:'paired PSK'}
  } else {
    lengths = batches.map((b,i)=>{
      const options={rootSecret:cryptoRoot,wireDeviceId:1,sequence:i+1,slot:1,confirmed,batch:s.batch>1,payload:b}
      const frame=s.security?wire.buildFrame(options):plaintext.buildFrame(options)
      const decoded=s.security?wire.decryptFrame(frame,cryptoRoot):plaintext.decodeFrame(frame)
      if(!decoded.plaintext.equals(b)) throw Error('Struct frame round trip failed')
      if(s.security && confirmed && !wire.verifyReceipt(wire.buildReceipt(cryptoRoot,1,i+1),cryptoRoot,1,i+1)) throw Error('Receipt validation failed')
      return frame.length
    })
    r.parts.payload=payload.length*s.batch
    r.parts.framing=(s.security?wire.HEADER_BYTES:plaintext.HEADER_BYTES)*lengths.length+(s.batch>1?lengths.length:0)
    r.parts.security=s.security?wire.TAG_BYTES*lengths.length:0
    r.profile=`${s.security?'Secure V2':'V2-compatible plaintext LAB ONLY'} / ${s.precision} / ${s.delivery}`
    if(s.security) r.security={encryption:'ChaCha20-Poly1305',authentication:'Per-device root-derived keys',integrity:'16-byte AEAD tag',replay:'Durable monotonic gateway state',forwardSecrecy:'No',keys:'Root enrollment/rotation and persistent counter',tagBytes:16}
    r.reliability={guarantee:confirmed?(s.security?'database commit':'unauthenticated lab decode receipt'):'best effort',retries:s.security?'SDK retry client; zero-loss calculation':'No automatic retries in lab profile',deduplication:s.security?'Gateway durable replay state':'None',identity:s.security?'paired PSK':'none'}
    if(!s.security) r.notes.push('BENCHMARK ONLY: SLB0 domain prefix + control/device/sequence = 13-byte header; no encryption, tag, MAC or replay protection. Receipt is 9 unauthenticated bytes. Production gateways reject this generation. This is not an available production transport.')
  }
  r.implementation=legacy?'Repository legacy encoder':'Repository Secure V2 SDK / additive packed schema compiler'
  if(s.network==='IPv6')r.notes.push('IPv6 sizes use the identical datagram codec and a local udp6 receiver. Production gateway binding remains IPv4; deployment/configuration work is required for production IPv6.')
  const ip = s.network === 'IPv4' ? 20 : 40
  if (lengths.some((n) => n + 8 + ip > s.mtu))
    throw Error('A Struct datagram exceeds the selected MTU; fragmentation is not modeled.')
  const receipt = confirmed ? (legacy ? legacyWire.buildTelemetryReceipt(Buffer.alloc(32),'local-lab-only').length : s.security ? wire.RECEIPT_BYTES : plaintext.RECEIPT_BYTES) : 0
  udp(
    r,
    s,
    lengths.reduce((a, b) => a + b, 0),
    receipt * lengths.length,
    lengths.length,
    confirmed ? lengths.length : 0,
  )
  r.metrics.payload = metric(
    payload.length * s.batch,
    'Actual Struct serializer output summed across logical readings; batch count is framing.',
  )
  r.payloadHex = payload.toString('hex')
  r.decoded = safeJson(p.decoded)
  r.sources = ['struct-source']
  r.notes.push(
    `Response policy: ${confirmed ? (s.security || legacy ? 'authenticated receipt per frame' : 'unauthenticated lab decode receipt') : 'no response'}.`,
    `${lengths.length} datagram(s) for ${s.batch} reading(s); SDK frame maximum 1200 B for V2.`,
  )
}
function coapResult(r: LabResult, p: Prepared, s: LabSettings) {
  const payload = serialize(s.coapEncoding, p, s),
    token = Buffer.alloc(s.coapToken, 0x51),
    confirmed = s.delivery === 'confirmed'
  const content = s.coapEncoding === 'protobuf' ? 42 : s.coapEncoding.startsWith('json') ? 50 : 60
  const options: coap.NamedOption[] = [
    ...s.coapPath
      .split('/')
      .filter(Boolean)
      .map((x) => ({ name: 'Uri-Path' as const, value: Buffer.from(x) })),
    { name: 'Content-Format', value: Buffer.from([content]) },
  ]
  const plain = coap.generate(
    { code: 'POST', messageId: 100, token, confirmable: confirmed, options, payload },
    100000,
  )
  let up = plain.length,
    down = 4 + token.length,
    framing = plain.length - payload.length,
    tag = 0
  if (s.security) {
    tag = s.oscore === 'AES-CCM-16-64-128' ? 8 : 16
    const seq = s.oscoreSequence === 0 ? 1 : Math.ceil(Math.log2(s.oscoreSequence + 1) / 8)
    const piv = Buffer.alloc(seq)
    piv.writeUIntBE(s.oscoreSequence, 0, seq)
    const oscoreOption = Buffer.concat([Buffer.from([0x08 | seq]), piv, Buffer.from([1])])
    // RFC8613 inner code + encrypted class-E options/payload, then outer OSCORE option.
    const inner = Buffer.concat([Buffer.from([2]), plain.subarray(4 + token.length)])
    const outer = coap.generate(
      {
        code: 'POST',
        messageId: 100,
        token,
        confirmable: confirmed,
        options: [{ name: 'OSCORE', value: oscoreOption }],
        payload: Buffer.alloc(inner.length + tag),
      },
      100000,
    )
    const response = coap.generate(
      {
        code: '2.04',
        messageId: 100,
        token,
        ack: confirmed,
        options: [{ name: 'OSCORE', value: Buffer.alloc(0) }],
        payload: Buffer.alloc(1 + tag),
      },
      100000,
    )
    up = outer.length
    down = response.length
    framing = up - payload.length - tag
    r.security = {
      encryption: s.oscore === 'ChaCha20/Poly1305' ? 'ChaCha20-Poly1305' : 'AES-CCM',
      authentication: 'Paired OSCORE context',
      integrity: `${tag}-byte AEAD tag`,
      replay: 'OSCORE sliding replay window',
      forwardSecrecy: 'No',
      keys: 'Provision context/IDs, retain sequence, rotate before exhaustion; EDHOC not tested',
      tagBytes: tag,
    }
  }
  r.parts.payload = payload.length
  r.parts.framing = framing
  r.parts.security = tag
  udp(r, s, up, down, 1, 1)
  r.profile = `${s.coapEncoding} / ${s.security ? 'OSCORE ' + s.oscore : 'UDP plaintext'} / ${confirmed ? 'CON' : 'NON'}`
  r.implementation = 'coap-packet 1.1.1; RFC8613 envelope validated against aiocoap 0.4.17'
  r.reliability = {
    guarantee: confirmed ? 'resource processed' : 'best effort + response',
    retries: confirmed
      ? 'CoAP retransmission supported; zero-loss accounting only'
      : 'No CoAP retransmission for NON',
    deduplication: 'Message/context handling; no database-persistence guarantee',
    identity: s.security ? 'paired PSK' : 'none',
  }
  r.metrics.payload = metric(
    payload.length,
    'Actual serializer output, including application array/repeated-message envelope when batching.',
  )
  r.payloadHex = payload.toString('hex')
  r.decoded = safeJson(p.decoded)
  r.sources = ['coap-rfc', 'oscore-rfc', 'cbor-rfc']
  r.notes.push(
    'Response policy: 2.04 application response, including for NON.',
    `OSCORE sequence ${s.oscoreSequence}, sender KID 01, no context ID; response bound to request.`,
    `Batching uses an application envelope, not native telemetry batching.`,
  )
}
function varint(n: number): number {
  let bytes = 1
  while (n >= 128) {
    n = Math.floor(n / 128)
    bytes++
  }
  return bytes
}
function mqttResult(
  r: LabResult,
  p: Prepared,
  s: LabSettings,
  codec: string,
  data: ResearchIndex,
  schema: string | undefined,
) {
  const payload = serialize(codec, p, s),
    qos = s.qos === 'auto' ? (s.delivery === 'confirmed' ? 1 : 0) : s.qos
  let props = 0
  if (s.mqttVersion === 5 && s.mqttProperties)
    props =
      1 +
      2 +
      Buffer.byteLength('schema') +
      2 +
      Buffer.byteLength('environment-v1') +
      1 +
      2 +
      Buffer.byteLength('application/octet-stream')
  const body =
    2 +
    Buffer.byteLength(s.topic) +
    (qos > 0 ? 2 : 0) +
    (s.mqttVersion === 5 ? varint(props) + props : 0) +
    payload.length
  let up = 1 + varint(body) + body,
    down = qos === 0 ? 0 : 4
  if (qos === 2) {
    up += 4
    down += 4
  }
  const profile = `${codec}+MQTT+${s.security ? 'TLS' : 'TCP'}`
  const exact = find(
    data,
    schema,
    (profileRow) =>
      profileRow.protocol_stack === profile &&
      profileRow.connection_mode === 'persistent' &&
      profileRow.network_type === s.network &&
      profileRow.batch_size === s.batch &&
      profileRow.security_configuration === (s.security ? s.tls : null) &&
      profileRow.protocol_specific_settings.mqtt_version === s.mqttVersion &&
      profileRow.protocol_specific_settings.qos === qos &&
      profileRow.protocol_specific_settings.topic === s.topic &&
      profileRow.protocol_specific_settings.properties === s.mqttProperties,
  )
  r.profile = `MQTT ${s.mqttVersion === 5 ? '5' : '3.1.1'} / ${s.security ? s.tls : 'TCP'} / QoS ${qos} / ${codec}`
  r.implementation = 'protobuf.js 8.8.0 / node-cbor 10.0.12 / JSON; references Paho 2.1 + NanoMQ 0.25.6'
  r.parts.payload = payload.length
  r.parts.framing = up - payload.length
  r.parts.security = s.security ? null : 0
  r.metrics.payload = metric(payload.length, 'Actual encoded batch, not a fixed per-field estimate.')
  r.metrics.applicationUp = metric(
    up,
    'Exact MQTT PUBLISH/PUBREL framing from topic, properties, QoS and Remaining Length.',
  )
  r.metrics.applicationDown = metric(
    down,
    'Selected broker shortened acknowledgment forms; publisher leg only.',
  )
  r.metrics.networkUp = unknown('TCP segments, options, ACKs and IP packet counts were not captured.')
  r.metrics.networkDown = unknown('Full TCP/IP traffic unavailable.')
  r.metrics.exchange = unknown('TLS stream bytes are not full network bytes.')
  r.metrics.transport = unknown('TCP packetization unavailable.')
  r.metrics.network = unknown('TCP/IP packetization unavailable.')
  let streamUp = s.security ? null : up,
    streamDown = s.security ? null : down
  if (
    exact &&
    number(exact, 'application_uplink_bytes') === up &&
    number(exact, 'application_downlink_bytes') === down
  ) {
    streamUp = number(exact, 'stream_uplink_bytes')
    streamDown = number(exact, 'stream_downlink_bytes')
    r.references.push(exact.id)
    if (s.security && streamUp !== null) r.parts.security = streamUp - up
    r.metrics.setup = metric(
      number(exact, 'handshake_bytes'),
      'Measured reference setup stream, excluding TCP SYN/ACK.',
      'measured',
    )
  } else r.metrics.setup = unknown('No matching handshake measurement for these settings.')
  let connection: number | null = 0
  if (s.includeSetup && s.connection !== 'persistent') {
    const session = find(
      data,
      schema,
      (profileRow) =>
        profileRow.protocol_stack === profile &&
        profileRow.security_configuration === (s.security ? s.tls : null) &&
        profileRow.network_type === s.network &&
        profileRow.protocol_specific_settings.mqtt_version === s.mqttVersion &&
        profileRow.protocol_specific_settings.qos === qos &&
        profileRow.protocol_specific_settings.topic === s.topic &&
        profileRow.protocol_specific_settings.readings_per_connection ===
          (s.connection === 'fresh' ? 1 : s.messagesPerConnection) &&
        s.batch === 1 &&
        !s.mqttProperties,
    )
    if (session) {
      r.references.push(session.id)
      const total = number(session, 'amortized_session_stream_bytes_per_reading')
      if (s.traffic === 'exchange' && total !== null) {
        r.metrics.stream = metric(
          total,
          'Measured complete session stream amortized per logical reading; includes setup, maintenance, termination; TCP/IP excluded.',
          'measured',
        )
        connection = streamUp === null || streamDown === null ? null : total - streamUp - streamDown
      } else
        r.metrics.stream = unknown(
          'Directional complete-session amortization is not retained by this reference.',
        )
    } else
      r.metrics.stream = unknown(
        'No measured session matches this connection reuse/topic/schema combination.',
      )
  } else
    r.metrics.stream = metric(
      streamUp === null || streamDown === null
        ? null
        : streamUp + (s.traffic === 'exchange' ? streamDown : 0),
      s.security
        ? 'Exact matching measured TLS stream. Record splitting is never guessed for a custom schema.'
        : 'Exact MQTT plaintext stream; TCP/IP excluded.',
      s.security ? 'measured' : 'calculated',
    )
  r.parts.connection = connection
  r.parts.response = s.traffic === 'exchange' ? (s.boundary === 'stream' ? streamDown : down) : 0
  r.metrics.maintenance = unknown('Keepalives are retained in session references, not universally inferred.')
  if (s.security)
    r.security = {
      encryption: s.tls,
      authentication: 'Certificate-verified server; publisher anonymous in benchmark',
      integrity: 'Negotiated TLS AEAD',
      replay: 'Connection record sequences; application replay separate',
      forwardSecrecy: 'Ephemeral handshake',
      keys: 'Trust anchors/certificates; device credential policy separately required',
      tagBytes: 16,
    }
  r.reliability = {
    guarantee:
      qos === 0 ? 'broker fire and forget' : qos === 1 ? 'broker acknowledged' : 'broker QoS2 exchange',
    retries: qos
      ? 'MQTT retransmission/session semantics; no retry traffic invented'
      : 'TCP delivery only; no MQTT publish acknowledgment',
    deduplication:
      qos === 2
        ? 'QoS2 between client and broker; application persistence separate'
        : 'Application deduplication separate',
    identity: s.security ? 'server certificate' : 'none',
  }
  r.payloadHex = payload.toString('hex')
  r.decoded = safeJson(p.decoded)
  r.sources = ['protobuf-encoding', 'mqtt-5', 'mqtt-311', 'tls13-rfc', 'cbor-rfc', 'json-rfc', 'lab-tls-model']
  modelTcp(r, s, up, down, qos === 2 ? 2 : 1, qos === 2 ? 2 : down ? 1 : 0)
  r.notes.push(
    'Response policy: MQTT publisher/broker acknowledgment only.',
    'Subscriber traffic is excluded. TCP/IP headers/ACKs use an explicit model, not captures.',
    'Stream values prefer exact measured references; custom streams/network totals use the disclosed TLS flight model. Setup requires matching references; keepalives remain excluded.',
  )
}
function coapDtls(r:LabResult,p:Prepared,s:LabSettings,data:ResearchIndex,schema:string|undefined){
  const cipher=s.coapSecurity==='dtls-ccm8'?'TLS_PSK_WITH_AES_128_CCM_8':'TLS_PSK_WITH_AES_128_CCM'
  r.profile=`CoAP / DTLS 1.2 / ${cipher} / measured echo reference`
  if(s.network!=='IPv4' || s.coapPath!=='/t')throw Error('DTLS references require IPv4 and /t; custom paths/IPv6 are not measured. Select OSCORE for a custom calculation.')
  const payload=serialize(s.coapEncoding,p,s)
  const exact=find(data,schema,q=>q.protocol_stack===`${s.coapEncoding}+CoAP+DTLS` && q.security_configuration===cipher && q.batch_size===s.batch && q.delivery_mode===(s.delivery==='confirmed'?'CON 2.04 response':'NON 2.04 response'))
  if(!exact || number(exact,'serialized_payload_bytes')!==payload.length)throw Error('No matching DTLS measurement for this schema/serialization/batch. References cover Protobuf, JSON and named CBOR; OSCORE supports custom schemas.')
  const up=number(exact,'application_uplink_bytes')!,down=number(exact,'application_downlink_bytes')!
  const upCount=number(exact,'transport_header_bytes')!/8,downCount=(number(exact,'total_downlink_bytes')!-down)/28,tag=s.coapSecurity==='dtls-ccm8'?8:16
  udp(r,s,up,down,upCount,downCount,'measured')
  r.status='measured';r.references=[exact.id];r.implementation='Californium/Scandium 4.0.0-M6'
  r.metrics.payload=metric(payload.length,'Actual selected serializer output matches the measured DTLS reference.')
  r.parts.payload=payload.length;r.parts.security=tag*upCount;r.parts.framing=up-payload.length-tag*upCount
  r.payloadHex=payload.toString('hex');r.decoded=safeJson(p.decoded)
  r.security={encryption:'DTLS 1.2 / AES-128-CCM',authentication:'Paired PSK',integrity:`${tag}-byte CCM tag`,replay:'DTLS record window; negative tests not retained for this reference',forwardSecrecy:'No (PSK cipher)',keys:'DTLS PSK association and rotation',tagBytes:tag}
  r.reliability={guarantee:'CoAP endpoint echoed decoded request; no database persistence',retries:s.delivery==='confirmed'?'CoAP CON; zero-loss reference':'NON; no CoAP retransmission',deduplication:'CoAP exchange handling',identity:'paired PSK'}
  r.metrics.setup=unknown('Archived initialization combines handshake and warmup; not normalized as pure setup.')
  r.sources=['coap-rfc','dtls12-rfc','californium','dtls-cid-rfc']
  r.notes.push('Exact archived reference uses library-generated token and /t, not the OSCORE token control. Response echoes the payload. No native IPv6/custom DTLS model is inferred.')
  if(s.includeSetup && s.connection!=='persistent')throw Error('DTLS lifecycle normalization is not implemented; steady-state references remain available with setup excluded.')
}
function httpsResult(
  r: LabResult,
  p: Prepared,
  s: LabSettings,
  data: ResearchIndex,
  schema: string | undefined,
) {
  const body = serialize(s.jsonEncoding, p, s),
    payload = s.compression === 'gzip' ? gzipSync(body, { mtime: 0 } as Parameters<typeof gzipSync>[1]) : body
  r.profile = `${s.jsonEncoding} / HTTPS TLS / ${s.compression}`
  r.parts.payload = payload.length
  r.metrics.payload = metric(
    payload.length,
    s.compression === 'gzip'
      ? 'Actual gzip-compressed JSON body; gzip framing included.'
      : 'Actual JSON body.',
  )
  r.payloadHex = payload.toString('hex')
  r.decoded = safeJson(p.decoded)
  r.implementation = 'Node JSON/gzip; reference Python HTTP1.1 / OpenSSL'
  const exact = find(
    data,
    schema,
    (q) =>
      q.protocol_stack === `${s.jsonEncoding}+HTTPS/TLS` &&
      q.security_configuration === s.tls &&
      q.batch_size === s.batch &&
      q.network_type === s.network &&
      q.connection_mode === (s.connection === 'fresh' ? 'new connection per message' : 'persistent') &&
      q.protocol_specific_settings.content_encoding === (s.compression === 'gzip' ? 'gzip' : 'identity'),
  )
  if (exact && (s.compression !== 'gzip' || number(exact, 'compressed_payload_bytes') === payload.length)) {
    r.references.push(exact.id)
    r.metrics.applicationUp = metric(
      number(exact, 'application_uplink_bytes'),
      'Measured reference HTTP request headers/body.',
      'measured',
    )
    r.metrics.applicationDown = metric(
      number(exact, 'application_downlink_bytes'),
      'Measured reference HTTP response.',
      'measured',
    )
    const up = number(exact, 'stream_uplink_bytes'),
      down = number(exact, 'stream_downlink_bytes')
    r.metrics.stream = metric(
      up === null || down === null ? null : up + (s.traffic === 'exchange' ? down : 0),
      'Matching TLS stream reference; TCP/IP excluded.',
      'measured',
    )
    r.metrics.setup = metric(
      number(exact, 'handshake_bytes'),
      'Measured TLS setup only; TCP setup excluded.',
      'measured',
    )
    r.parts.framing =
      r.metrics.applicationUp.value === null ? null : r.metrics.applicationUp.value - payload.length
    r.parts.security =
      up === null || r.metrics.applicationUp.value === null ? null : up - r.metrics.applicationUp.value
    r.parts.response =
      s.traffic === 'exchange' ? (s.boundary === 'stream' ? down : r.metrics.applicationDown.value) : 0
    if (s.includeSetup && s.connection !== 'persistent')
      r.metrics.stream = unknown(
        'Directional HTTPS full-session accounting is not normalized; use measured reference explorer.',
      )
  } else {
    const request=Buffer.from(`POST /telemetry HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\n${s.compression==='gzip'?'Content-Encoding: gzip\r\n':''}\r\n`)
    const responseBody=JSON.stringify({sha256:createHash('sha256').update(body).digest('hex')})
    const response=Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(responseBody)}\r\n\r\n${responseBody}`)
    r.metrics.applicationUp=metric(request.length+payload.length,'Explicit example HTTP/1.1 headers (Host localhost, no Date/Server headers) plus actual body; not the archived Python header convention.')
    r.metrics.applicationDown=metric(response.length,'Explicit 200 JSON SHA256 receipt; no durable persistence guarantee.')
    r.metrics.stream=unknown('Custom HTTP TLS streams are modeled, not captured.')
    r.metrics.setup=unknown('No matching custom HTTP handshake.')
    r.parts.framing=request.length
    r.notes.push('Custom HTTP framing uses the displayed localhost header convention; actual server/client headers and TLS writes can differ.')
  }
  modelTcp(r,s,r.metrics.applicationUp.value!,r.metrics.applicationDown.value!,2,2,[r.metrics.applicationUp.value!-payload.length,payload.length],[r.metrics.applicationDown.value!-77,77])
  if (!s.security)
    throw Error('This HTTP configuration was tested only over TLS; unsecured HTTP is not a silent fallback.')
  r.security = {
    encryption: s.tls,
    authentication: 'Certificate-verified server',
    integrity: 'TLS AEAD',
    replay: 'Connection sequence; application replay separate',
    forwardSecrecy: 'Ephemeral handshake',
    keys: 'Server certificates/trust anchors; client identity separately provisioned',
    tagBytes: 16,
  }
  r.reliability = {
    guarantee: 'HTTP endpoint decoded body',
    retries: 'Application retry policy; not modeled',
    deduplication: 'Application idempotency required',
    identity: 'server certificate',
  }
  r.sources = ['tls13-rfc', 'json-rfc', 'lab-tls-model']
  r.notes.push('Response policy: HTTP 200 after JSON decode, no durable database guarantee.')
}
function lwm2m(r: LabResult, p: Prepared, s: LabSettings, data: ResearchIndex, schema: string | undefined) {
  r.profile = `LwM2M 1.1 / ${s.lwm2mFormat} / ${s.security ? 'DTLS 1.2 ECDHE-PSK' : 'CoAP UDP'} / native Send`
  if (s.lwm2mFormat === 'TLV')
    throw Error(
      'TLV is measured for server Read, not native Send. Use the reference explorer for Read; no unsolicited TLV Send is fabricated.',
    )
  const exact = s.batch===1 && s.network==='IPv4' && s.precision==='original' ? find(data,schema,q=>q.protocol_stack===`LwM2M+CoAP+${s.security?'DTLS':'UDP'}` && q.delivery_mode==='Send 2.04 Changed' && q.protocol_specific_settings.content_format===s.lwm2mFormat) : undefined
  if (!exact) {
    const encoded=encodeSenml(p,s)
    const dtls=s.security?44:0 // archived Scandium CID6/GCM: record19 + nonce8 + inner-type1 + tag16
    udp(r,s,encoded.packet.length+dtls,encoded.response.length+dtls,1,1)
    r.status=s.security?'estimated':'calculated'
    if(s.security) for(const key of ['applicationUp','applicationDown','networkUp','networkDown','exchange'])r.metrics[key]!.evidence='estimated'
    r.parts.payload=encoded.payload.length;r.parts.framing=encoded.packet.length-encoded.payload.length+(s.security?28:0);r.parts.security=s.security?16:0
    r.metrics.payload=metric(encoded.payload.length,'Real RFC8428 SenML encoding; explicit custom object /33000/0, resource IDs follow field order. Batched readings have example relative time 0..n-1 seconds.')
    r.payloadHex=encoded.payload.toString('hex');r.decoded=safeJson(p.decoded)
    r.implementation='node-cbor / JSON / coap-packet; Scandium CID6 GCM envelope length model'
    r.profile=`LwM2M 1.1 custom Send / ${s.lwm2mFormat} / ${s.security?'DTLS 1.2 envelope MODEL':'CoAP UDP'}`
    r.reliability={guarantee:'Send 2.04 acceptance; no storage guarantee',retries:s.delivery==='confirmed'?'CoAP retransmission; zero-loss model':'NON, no retry',deduplication:'Receiver-specific',identity:s.security?'paired PSK':'none'}
    if(s.security)r.security={encryption:'DTLS 1.2 / AES-128-GCM',authentication:'ECDHE-PSK',integrity:'16-byte GCM tag',replay:'DTLS record window',forwardSecrecy:'Ephemeral handshake',keys:'PSK, registration and rotation',tagBytes:16}
    r.metrics.setup=unknown('Custom-object registration and handshake are not captured. Lifecycle costs excluded.')
    r.sources=['lwm2m11','leshan','senml-rfc','lab-senml-validation','lab-dtls-model']
    r.notes.push('Custom-object Send model: new scalar resource mapping, not a substitute for an original Leshan measurement. Registration/update/handshake/keepalives excluded; DTLS overhead assumes the archived CID6/GCM profile. Confirm endpoint object interoperability before deployment.', 'Response policy: Send 2.04; no durable storage claim.')
    if(s.includeSetup && s.connection!=='persistent')throw Error('Custom LwM2M registration/DTLS lifecycle accounting remains unmeasured. Disable setup to inspect steady state.')
    return
  }
  r.status = 'measured'
  r.references = [exact.id]
  r.implementation = 'Eclipse Leshan 2.0.0-M18 / Scandium 4.0.0-M6'
  const up = number(exact, 'application_uplink_bytes')!,
    down = number(exact, 'application_downlink_bytes')!,
    count = number(exact, 'transport_header_bytes')! / 8
  const downCount = ((number(exact, 'total_downlink_bytes') ?? down) - down) / 28
  udp(r, s, up, down, count, downCount, 'measured')
  r.metrics.setup = unknown(
    'Registration and DTLS initialization are separate lifecycle observations; no matching amortized setup value is retained in this Send record.',
  )
  r.metrics.payload = unknown(
    'Network runner did not separately instrument decrypted SenML serialization; codec records are separate.',
  )
  r.parts.payload = 0
  r.parts.framing = null
  r.parts.security = null
  r.reliability = {
    guarantee: 'LwM2M server accepted Send',
    retries: 'CoAP/DTLS lifecycle; zero-loss reference',
    deduplication: 'Protocol handling; durable storage separate',
    identity: s.security ? 'paired PSK' : 'none',
  }
  if (s.security)
    r.security = {
      encryption: 'DTLS 1.2 / AES-128-GCM',
      authentication: 'ECDHE-PSK',
      integrity: '16-byte GCM tag',
      replay: 'DTLS record window; negative tests pending',
      forwardSecrecy: 'Ephemeral handshake',
      keys: 'PSK provisioning, registration, renewal, key lifecycle',
      tagBytes: 16,
    }
  r.sources = ['leshan', 'lwm2m11', 'ecdhe-psk-rfc', 'dtls-cid-rfc']
  r.notes.push(
    'Response policy: native Send 2.04 accepted by Leshan.',
    'Unconfirmed global mode does not disable LwM2M native Send responses.',
    'Registration, update and DTLS initialization are separate lifecycle traffic, excluded from steady state.',
  )
  if (s.includeSetup)
    throw Error(
      'LwM2M registration/update amortization is not implemented; measurements are available separately in the explorer.',
    )
}
export function calculate(config: LabConfig, data: ResearchIndex, withScaling = true): LabResponse {
  validateConfig(config)
  const s = config.settings,
    p = prepare(config.fields, s),
    schema = referenceSchema(config, data),
    warnings = [...p.warnings]
  if (
    s.precision === 'optimized' &&
    config.fields.some(
      (f) =>
        ['float32', 'float64'].includes(f.type) &&
        (f.min === undefined || f.max === undefined || f.step === undefined),
    )
  )
    warnings.push(
      'Fields without complete min/max/step retain their original representation. No lossy constraints were invented.',
    )
  if (s.loss || s.latency)
    warnings.push(
      'Impairment settings select measured research references only. Custom traffic and ROI are not adjusted by assumed loss multipliers or latency.',
    )
  if (s.connection !== 'persistent' && !s.includeSetup)
    warnings.push(
      'Connection costs are excluded: these are steady-state bytes. Enable measured session costs to account for reconnections where an exact reference exists.',
    )
  const results = (Object.keys(protocolNames) as ProtocolId[]).map((id) => {
    const r = result(id, s)
    try {
      if (id === 'struct') struct(r, p, s)
      else if (id === 'coap') {if(s.security && s.coapSecurity && s.coapSecurity!=='oscore')coapDtls(r,p,s,data,schema);else coapResult(r,p,s)}
      else if (id === 'lwm2m') lwm2m(r, p, s, data, schema)
      else if (id === 'json' && s.jsonTransport === 'https') httpsResult(r, p, s, data, schema)
      else
        mqttResult(
          r,
          p,
          s,
          id === 'protobuf' ? 'protobuf' : id === 'cbor' ? s.cborEncoding : s.jsonEncoding,
          data,
          schema,
        )
      finalMetric(r, s)
      if (s.loss || s.latency) {
        r.notes.push(
          'Nonzero loss/latency custom-scenario traffic has not been measured; steady-state values remain visible separately.',
        )
        r.metrics.selected = unknown(
          'Custom impairment traffic unknown. Inspect measured reference scenarios.',
        )
        r.metrics.effective = unknown('Retries/delivery under this custom impairment scenario are unknown.')
      }
      if (!r.references.length && schema) {
        const ref = find(
          data,
          schema,
          (q, x) =>
            q.batch_size === s.batch &&
            q.security_enabled === s.security &&
            q.network_type === s.network &&
            number(x, 'application_uplink_bytes') === r.metrics.applicationUp?.value &&
            number(x, 'application_downlink_bytes') === r.metrics.applicationDown?.value &&
            (id === 'struct'
              ? q.protocol_category === 'Struct' && q.delivery_mode === s.delivery
              : id === 'coap'
                ? q.protocol_stack === `${s.coapEncoding}+CoAP+${s.security ? 'OSCORE+UDP' : 'UDP'}` &&
                  q.security_configuration === (s.security ? s.oscore : null) &&
                  q.protocol_specific_settings.token_length === s.coapToken &&
                  JSON.stringify(q.protocol_specific_settings.uri_path) ===
                    JSON.stringify(s.coapPath.split('/').filter(Boolean)) &&
                  (!s.security || number(x, 'oscore_sender_sequence') === s.oscoreSequence)
                : false),
        )
        if (ref) r.references.push(ref.id)
      }
    } catch (error) {
      r.reason = error instanceof Error ? error.message : 'Calculation failed.'
      r.status = /unmeasured|not implemented|amortization|No matching DTLS measurement|not measured/i.test(r.reason) ? 'not_tested' : 'unsupported'
      r.metrics.effective = unknown(r.reason)
      r.metrics.selected = unknown(r.reason)
      r.notComparable.push(r.reason)
    }
    return r
  })
  const base = results.find((r) => r.id === s.baseline)!
  for (const r of results) {
    if (r.id === base.id && r.metrics.effective?.value !== null) {
      r.reduction = 0
      r.difference = 0
      r.comparison={category:'direct',data:'Baseline data',security:'Baseline security profile',delivery:'Baseline delivery profile',measurement:`${s.boundary} ${s.traffic} bytes per logical reading`,warnings:[]}
      continue
    }
    if (r.metrics.effective?.value === null || base.metrics.effective?.value === null) {
      r.notComparable.push('Selected measurement unavailable for this protocol or baseline.')
      r.comparison={category:r.status==='unsupported'?'unsupported':'incomplete',data:'Prepared data',security:'See profile',delivery:'See profile',measurement:'Missing selected boundary',warnings:[...r.notComparable]}
      continue
    }
    if (r.boundary !== base.boundary) {r.notComparable.push('Measurement boundaries differ.');continue}
    const security = JSON.stringify(r.security) === JSON.stringify(base.security)
    const delivery = r.reliability.guarantee === base.reliability.guarantee
    const warnings: string[]=[]
    if(!security)warnings.push('Security algorithms, identity, forward secrecy or protection scope differ; size difference is not an equivalent-security savings claim.')
    if(!delivery)warnings.push('Acknowledgments and response policies differ; size difference does not establish equivalent delivery or storage guarantees.')
    if(r.metrics.effective!.evidence==='estimated' || base.metrics.effective!.evidence==='estimated')warnings.push('Network/record model assumptions apply; this is not captured traffic.')
    r.notComparable.push(...warnings)
    r.comparison={category:warnings.length?'disclosed_differences':'direct',data:'Same prepared logical data and declared precision',security:security?'Matching documented profile':'Different properties; see security details',delivery:delivery?'Matching guarantee':'Different response/processing guarantees',measurement:`Same ${s.boundary} ${s.traffic} bytes per logical reading`,warnings}
    r.difference = base.metrics.effective!.value! - r.metrics.effective!.value!
    r.reduction =
      base.metrics.effective!.value! > 0 ? (r.difference / base.metrics.effective!.value!) * 100 : null
  }
  const scaling: LabResponse['scaling'] = []
  if (withScaling) {
    // Actual encoders at each batch point; no interpolation across varint/frame boundaries.
    const points =
      s.scaling === 'batch'
        ? [1, 2, 5, 10, 25, 50, 100]
        : s.scaling === 'fields'
          ? [1, 2, 3, 5, 10, 20, 50, 100]
          : [1, 16, 64, 256, 1024, 4096, 16384]
    for (const x of points) {
      const fields =
        s.scaling === 'fields'
          ? Array.from({ length: x }, (_, i) => ({ ...config.fields[0]!, id: `scale-${i}`, name: `f${i}` }))
          : s.scaling === 'bytes'
            ? [
                {
                  id: 'binary',
                  name: 'value',
                  type: 'bytes' as const,
                  value: '00'.repeat(x),
                  width: 8,
                  optional: false,
                  absent: false,
                  repeated: false,
                },
              ]
            : config.fields
      try {
        const response = calculate(
          { fields, settings: { ...s, batch: s.scaling === 'batch' ? x : s.batch } },
          data,
          false,
        )
        scaling.push({
          x,
          values: Object.fromEntries(response.results.map((r) => [r.id, r.metrics.effective?.value ?? null])),
        })
      } catch {
        scaling.push({ x, values: Object.fromEntries(results.map((r) => [r.id, null])) })
      }
    }
  }
  return {
    results,
    warnings,
    schemaHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
    scaling,
  }
}

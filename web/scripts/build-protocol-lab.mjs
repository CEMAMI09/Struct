// Build a sanitized, server-only index. Never publish raw packets or credentials.
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createGunzip, gzipSync } from 'node:zlib'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const research = new URL('../../benchmarks/multi-protocol/', import.meta.url)
const read = (path) => JSON.parse(readFileSync(new URL(path, research), 'utf8'))
const profiles = [],
  records = [],
  known = new Map()
const profileKeys = [
  'benchmark_version',
  'protocol_category',
  'protocol_stack',
  'implementation',
  'implementation_version',
  'specification_version',
  'precision_policy',
  'security_enabled',
  'security_configuration',
  'delivery_mode',
  'batch_size',
  'network_type',
  'connection_mode',
  'protocol_specific_settings',
  'source_references',
  'comparison_scope',
  'measurement_provenance',
  'delivery_guarantee',
]
const valueKeys = [
  'serialized_payload_bytes',
  'application_uplink_bytes',
  'application_downlink_bytes',
  'transport_header_bytes',
  'network_header_bytes',
  'total_uplink_bytes',
  'total_downlink_bytes',
  'total_network_bytes',
  'handshake_bytes',
  'maintenance_bytes',
  'retransmission_bytes',
  'effective_bytes_per_reading',
  'stream_uplink_bytes',
  'stream_downlink_bytes',
  'initialization_network_bytes',
  'total_session_stream_bytes',
  'amortized_session_stream_bytes_per_reading',
  'termination_bytes',
  'logical_readings',
  'oscore_sender_sequence',
  'coap_plain_datagram_bytes',
  'security_increment_bytes',
  'negotiated_tls_cipher',
  'negotiated_dtls_cipher',
  'dtls_connection_id_bytes',
  'datagram_count',
  'decoding_verified',
  'decoded_readings_count',
  'precision_error',
  'test_status',
  'measurement_type',
  'reason',
  'raw_artifact',
  'raw_line',
  'tamper_rejected',
  'replay_rejected',
  'source_hashes',
  'production_parser_rejected',
  'delivery_success_rate',
  'unique_readings_received',
  'actual_retransmitted_datagrams',
  'sink_unobserved_attempts',
  'host_exchange_latency_ns',
  'host_exchange_latency_ms',
]
const extensionFile='extensions/lab-v2/records.ndjson.gz'
const inputFiles=['results/normalized/records.ndjson.gz', ...(existsSync(new URL(extensionFile,research))?[extensionFile]:[])]
for (const inputFile of inputFiles) for await (const line of createInterface({
  input: createReadStream(new URL(inputFile, research)).pipe(createGunzip()),
  crlfDelay: Infinity,
})) {
  const source = JSON.parse(line)
  const profile = Object.fromEntries(
    profileKeys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
  )
  const environmentKeys = [
    'os',
    'python',
    'node',
    'java',
    'machine',
    'processor',
    'performance_scope',
    'packet_capture',
    'seed',
    'git_commit',
    'git',
    'arch',
  ]
  profile.environment_metadata = Object.fromEntries(
    environmentKeys
      .filter((k) => source.environment_metadata?.[k] !== undefined)
      .map((k) => [k, source.environment_metadata[k]]),
  )
  const key = JSON.stringify(profile)
  if (!known.has(key)) {
    known.set(key, profiles.length)
    profiles.push(profile)
  }
  const additionalKeys = [
    'timestamp',
    'compressed_payload_bytes',
    'handshake_uplink_bytes',
    'handshake_downlink_bytes',
    'connection_setup_latency_ns',
    'steady_stream_bytes_per_reading',
    'security_verified',
    'comparable',
    'offered_sender_application_bytes',
    'offered_sender_datagrams',
    'serialization_median_ns',
    'serialization_p95_ns',
    'deserialization_median_ns',
    'deserialization_p95_ns',
  ]
  records.push({
    id: source.test_id,
    schema: source.schema_id,
    profile: known.get(key),
    ...Object.fromEntries(
      [...valueKeys, ...additionalKeys].filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
    ),
  })
}
const schemas = [...read('schemas/library.json'), ...(existsSync(new URL('extensions/lab-v2/schemas.json',research))?read('extensions/lab-v2/schemas.json'):[])]
const coverage = read('results/summaries/coverage.json')
const extensionCount=existsSync(new URL('extensions/lab-v2/measurement-summary.json',research))?read('extensions/lab-v2/measurement-summary.json').total:0
if (records.length !== coverage.total_configurations + extensionCount) throw Error('Research coverage/index count mismatch')
coverage.original_configurations=coverage.total_configurations
coverage.extension_configurations=extensionCount
coverage.total_configurations=records.length
coverage.dataset_version='2.0.0'
coverage.test_status_counts=Object.fromEntries([...new Set(records.map(r=>r.test_status))].map(status=>[status,records.filter(r=>r.test_status===status).length]))
coverage.unique_schema_value_cases=new Set(records.map(r=>r.schema)).size
coverage.library_cases=schemas.length
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value
coverage.distinct_schema_definitions=new Set(schemas.map(s=>JSON.stringify(canonical(s.fields)))).size
coverage.successful_stacks={}
for(const r of records)if(r.test_status==='passed'){const stack=profiles[r.profile].protocol_stack;coverage.successful_stacks[stack]=(coverage.successful_stacks[stack]??0)+1}
const extensionRead = name => existsSync(new URL('extensions/lab-v2/'+name,research)) ? read('extensions/lab-v2/'+name) : []
const data = { version: '2.0.0', profiles, records, schemas, coverage }
const target = new URL('../server/assets/protocol-lab/', import.meta.url)
mkdirSync(target, { recursive: true })
// JSON.stringify normally erases -0, changing Python JSON reference lengths.
const negativeZeroMarker = '\u0000struct-lab-negative-zero\u0000'
const serialized = JSON.stringify(data, (_key, value) => {
  if (typeof value === 'string' && value.includes(negativeZeroMarker))
    throw Error('Reserved index marker collision')
  return Object.is(value, -0) ? negativeZeroMarker : value
})
  .split(JSON.stringify(negativeZeroMarker))
  .join('-0')
const compressed = gzipSync(serialized, { level: 9, mtime: 0 })
writeFileSync(new URL('index.json.gz', target), compressed)
const publicDir = new URL('../public/protocol-lab/', import.meta.url)
mkdirSync(publicDir, { recursive: true })
writeFileSync(
  new URL('metadata.json', publicDir),
  JSON.stringify({
    version: data.version,
    coverage,
    sources: [...read('references/sources.json'), ...extensionRead('sources.json')],
    security: [...read('references/security-matrix.json'), ...extensionRead('security-matrix.json')],
    compatibility: [...read('config/compatibility.json').filter(p=>p.protocol !== 'Struct JS SDK'), ...extensionRead('compatibility.json')],
    implementations: read('references/implementations.json'),
    presets: schemas.filter((s) => s.family === 'preset' || s.family === 'reference'),
    indexSha256: createHash('sha256').update(compressed).digest('hex'),
    researchUrl:
      'https://github.com/CEMAMI09/Struct/tree/e26318e7e83994ae0dcf8ab7829da4e111eb9fa5/benchmarks/multi-protocol',
  }),
)
console.log(
  `Protocol Lab: ${records.length} records, ${profiles.length} profiles, ${compressed.length} server-only bytes`,
)

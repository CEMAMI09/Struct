'use strict'
const {createHash}=require('node:crypto')
const wire=require('../sdk/js/secure-v2.cjs')
const {decryptSecret}=require('./auth')
const legacy=require('./parser-native')
const packed=require('../protocol/schema/bitpacked.cjs')
const roots=new Map()
const enabled=()=>process.env.STRUCT_SECURE_V2_ENABLED==='true'
function rootFor(credential) {
  const cached=roots.get(credential.wire_device_id)
  if(cached?.ciphertext===credential.root_secret_encrypted)return cached.root
  const root=decryptSecret(credential.root_secret_encrypted);wire.rootBytes(root)
  if(roots.size>=4096)roots.delete(roots.keys().next().value)
  roots.set(credential.wire_device_id,{ciphertext:credential.root_secret_encrypted,root});return root
}
class PostgresReplayStore {
  constructor(supabase){this.supabase=supabase}
  async accept({header,frame,records,metrics}) {
    const measured=require('./observability/collector').enabled()
    const {data,error}=await this.supabase.rpc(measured?'ingest_secure_v2_observed':'ingest_secure_v2_telemetry',{
      p_wire_device_id:header.wireDeviceId,p_sequence:header.sequence,
      p_frame_digest:`\\x${createHash('sha256').update(frame).digest('hex')}`,
      p_schema_slot:header.slot,p_records:records,...(measured?{p_metrics:metrics}:{}),
    })
    if(error)throw new Error(`Secure V2 storage rejected: ${error.message}`)
    if(!data||typeof data.inserted!=='boolean'||typeof data.duplicate!=='boolean'||data.inserted===data.duplicate||!Array.isArray(data.event_ids)||data.event_ids.length!==records.length||data.event_ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))||!['new','out_of_order','duplicate'].includes(data.replay)||(data.duplicate!==(data.replay==='duplicate')))throw new Error('Secure V2 storage returned invalid status')
    if(measured&&data.metrics_recorded===false)require('./observability/collector').health.commitGaps++
    return data
  }
}
async function lookup(supabase,wireDeviceId) {
  const {data:credential,error}=await supabase.from('secure_v2_credentials')
    .select('wire_device_id,device_id,root_secret_encrypted,expires_at,revoked_at').eq('wire_device_id',wireDeviceId).maybeSingle()
  if(error)throw new Error('Secure V2 identity lookup unavailable')
  if(!credential||Number(credential.wire_device_id)!==wireDeviceId||credential.revoked_at||(credential.expires_at&&(!Number.isFinite(Date.parse(credential.expires_at))||Date.parse(credential.expires_at)<=Date.now())))throw new Error('Secure V2 authentication failed')
  const result=await supabase.from('devices').select('id,name,organization_id,debug_trace_until,lifecycle').eq('id',credential.device_id).maybeSingle()
  if(result.error)throw new Error('Secure V2 identity lookup unavailable')
  if(!result.data||result.data.id!==credential.device_id||(result.data.lifecycle&&result.data.lifecycle!=='enabled'))throw new Error('Secure V2 authentication failed')
  return {credential,device:result.data}
}
async function processSecureV2(frame,ctx) {
  if(!enabled())throw new Error('Secure V2 is disabled')
  if(ctx.transport!=='udp')throw new Error('Secure V2 requires UDP')
  const maximum=wire.maxFrameBytes(Number(process.env.STRUCT_SECURE_V2_MAX_FRAME_BYTES||wire.DEFAULT_MAX_FRAME_BYTES))
  ctx.trace?.begin('receipt')
  const header=wire.parseHeader(frame,maximum)
  if(ctx.trace)Object.assign(ctx.trace.data,{protocol:'Struct Secure V2',cipher:'ChaCha20-Poly1305',encrypted:true,sequence:header.sequence,schema_slot:header.slot,receipt_requested:header.confirmed,batch:header.batch})
  ctx.trace?.begin('identity')
  const {credential,device}=await lookup(ctx.supabase,header.wireDeviceId)
  if(ctx.trace){ctx.trace.device=device;ctx.trace.correlate=ctx.trace.data.mode==='local'||Date.parse(device.debug_trace_until)>Date.now()}
  ctx.trace?.begin('authentication')
  let root,authenticated
  try{root=rootFor(credential);authenticated=wire.decryptFrame(frame,root,maximum)}catch{if(ctx.trace)ctx.trace.data.aead='failed';throw new Error('Secure V2 authentication failed')}
  if(ctx.trace)ctx.trace.data.aead='verified'
  require('./enterprise/metrics').authenticated()
  ctx.metricDevice=device
  ctx.trace?.finish()
  if(ctx.authorizeRate&&!ctx.authorizeRate(`secure-v2:${header.wireDeviceId}`).allowed)throw new Error('AUTHENTICATED_RATE_LIMIT')
  ctx.trace?.begin('schema')
  const {data:slot,error}=await ctx.supabase.from('secure_v2_schema_slots')
    .select('slot,encoding,schema_definition,sample_interval_ms,legacy_schema_version').eq('device_id',device.id).eq('slot',header.slot).maybeSingle()
  if(error)throw new Error('Secure V2 schema lookup unavailable')
  if(!slot||Number(slot.slot)!==header.slot||!Array.isArray(slot.schema_definition)||slot.schema_definition.length<1||slot.schema_definition.length>128||!['legacy-le-v1','bitpacked-v1'].includes(slot.encoding))throw new Error('Unknown Secure V2 schema slot')
  const codec=slot.encoding==='bitpacked-v1'?packed:legacy
  const recordBytes=codec.schemaByteLength(slot.schema_definition)
  ctx.trace?.begin('decoding')
  const payloads=wire.splitRecords(authenticated.plaintext,{batch:header.batch,recordBytes})
  const jsonSafe=value=>value instanceof Uint8Array?{$bytes:Buffer.from(value).toString('hex')}:typeof value==='bigint'?{$integer:value.toString()}:Array.isArray(value)?value.map(jsonSafe):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,jsonSafe(v)])):value
  const records=payloads.map(payload=>jsonSafe(slot.encoding==='bitpacked-v1'?packed.decodePayload(payload,slot.schema_definition):legacy.parsePayload(payload,slot.schema_definition)))
  if(ctx.trace){ctx.trace.secureV2Bytes(recordBytes*records.length,header.batch,header.confirmed);ctx.trace.data.batch_count=records.length;ctx.trace.data.aead='verified'}
  ctx.trace?.begin('storage')
  const metrics={app_bytes:frame.length,payload_bytes:recordBytes*records.length,framing_bytes:wire.HEADER_BYTES+(header.batch?1:0),ip_version:ctx.ipVersion??null,received_at:ctx.trace?.data?.started_at??new Date().toISOString(),processing_ms:Math.max(0,performance.now()-(ctx.metricStarted??performance.now()))}
  const store=ctx.replayStore||new PostgresReplayStore(ctx.supabase),result=await store.accept({header,frame,records,metrics})
  if(result.duplicate)require('./observability/collector').observe(ctx.supabase,{device_id:device.id,kind:'duplicate',app_bytes:frame.length,ip_version:ctx.ipVersion??null,category:'authenticated_duplicate'})
  if(ctx.trace){ctx.trace.data.replay=result.replay;ctx.trace.data.duplicate=result.duplicate;ctx.trace.data.event_id=result.event_ids[0];ctx.trace.data.event_ids=result.event_ids;ctx.trace.data.receipt_generated=header.confirmed;ctx.trace.finish()}
  if(typeof ctx.onTelemetryDeliver==='function'){
    try{await ctx.onTelemetryDeliver(device.id,device)}catch{console.warn('[struct] Secure V2 post-commit callback unavailable')}
  }
  return {kind:'telemetry',device,parsed:records[0],records,schemaVersion:slot.legacy_schema_version??header.slot,schemaSlot:header.slot,sequence:header.sequence,duplicate:result.duplicate,expected:recordBytes,received:authenticated.plaintext.length,eventIds:result.event_ids,receipt:header.confirmed?wire.buildReceipt(root,header.wireDeviceId,header.sequence):null}
}
module.exports={processSecureV2,PostgresReplayStore,enabled}

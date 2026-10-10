const stages=['receipt','identity','authentication','timestamp','schema','payload','decryption','decoding','storage','acknowledgment']
const statuses=['passed','failed','running']
const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:undefined
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)?value:undefined
const choose=(value:unknown,options:string[])=>typeof value==='string'&&options.includes(value)?value:undefined
const boundedInteger=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max?value:undefined
const flag=(value:unknown)=>typeof value==='boolean'?value:undefined
function secureV2Fields(value:any){return value?.protocol==='Struct Secure V2'?{protocol:'Struct Secure V2',cipher:choose(value.cipher,['ChaCha20-Poly1305']),encrypted:flag(value.encrypted),sequence:boundedInteger(value.sequence,0,4294967295),schema_slot:boundedInteger(value.schema_slot,0,15),batch_count:boundedInteger(value.batch_count,1,255),batch:flag(value.batch),aead:choose(value.aead,['verified','failed']),duplicate:flag(value.duplicate),receipt_requested:flag(value.receipt_requested),receipt_generated:flag(value.receipt_generated)}:{}}
export function sanitizeOutcome(value:any){return {packet_id:hex(value?.packet_id),status:choose(value?.status,['sent','committed','unknown']),attempts:count(value?.attempts),elapsedMs:count(value?.elapsedMs),...secureV2Fields(value),...(value?.protocol==='Struct Secure V2'?{payload_bytes:boundedInteger(value.payload_bytes,0,1375),frame_bytes:boundedInteger(value.frame_bytes,25,1400),ipv4_udp_bytes:boundedInteger(value.ipv4_udp_bytes,53,1428),receipt_bytes:boundedInteger(value.receipt_bytes,0,21)}:{})}}
export function sanitizeTrace(value:any){
 if(value?.fault==='Injected uplink loss before gateway receipt')return {mode:'local',fault:value.fault,stages:[],bytes:undefined,...secureV2Fields(undefined),replay:undefined}
 if(!value||!Array.isArray(value.stages)||value.stages.length>32)throw new Error('Invalid trace')
 const b=value.bytes
 return {
  id:uuid(value.id),event_id:uuid(value.event_id),packet_id:hex(value.packet_id),mode:choose(value.mode,['production','local']),transport:choose(value.transport,['tcp','udp']),
  started_at:typeof value.started_at==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value.started_at)?value.started_at:undefined,
  outcome:choose(value.outcome,['processed','failed']),frame_bytes:count(value.frame_bytes),
  ...secureV2Fields(value),
  replay:choose(value.replay,['new event','duplicate committed event','new','out_of_order','duplicate','stale','conflict']),
  acknowledgment:choose(value.acknowledgment,['built; device receipt not observed','not requested','injected receipt loss','sent to local SDK']),
  stages:value.stages.map((s:any)=>({stage:choose(s.stage,stages),status:choose(s.status,statuses),at_ms:count(s.at_ms),explanation:s.status==='failed'?stageHelp(s.stage):undefined})),
  bytes:b?{payload:count(b.payload),protocol:count(b.protocol),event_identity:count(b.event_identity),encryption:count(b.encryption),acknowledgment:count(b.acknowledgment),batch_metadata:boundedInteger(b.batch_metadata,0,1),security_overhead:boundedInteger(b.security_overhead,0,1400),frame:boundedInteger(b.frame,25,1400),ipv4_udp:boundedInteger(b.ipv4_udp,53,1428),ipv6_udp:boundedInteger(b.ipv6_udp,73,1448),transport_note:value.transport==='tcp'?'TCP overhead depends on segmentation, options and handshake':'IP + UDP headers; excludes link layer, radio attach, retransmissions and fragmentation'}:undefined,
 }
}
function stageHelp(stage:string){return ({receipt:'Check protocol, transport and frame size.',identity:'Check key ID and device registration.',authentication:'Check the current API secret, key rotation and packet corruption.',timestamp:'Synchronize the device clock and send within the replay window.',schema:'Publish the matching immutable schema version.',decryption:'Check encryption settings, key and payload length.',decoding:'Use the matching generated schema encoder.',storage:'The event could not be stored. Retry using the same event ID, and contact support if this continues.',acknowledgment:'The event may already be stored. Retry using the same identity.'} as Record<string,string>)[stage]||'Inspect the gateway configuration.'}
export function sanitizeWebhook(value:any){return {event_id:uuid(value?.event_id),status:choose(value?.status,['pending','sending','delivered','dead','skipped']),attempts:count(value?.attempts)}}

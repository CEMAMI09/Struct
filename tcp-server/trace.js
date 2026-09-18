const {randomUUID}=require('node:crypto')
const explanations={
 receipt:'Check packet size (maximum 1400 bytes), version and transport. Confirmed frames require UDP.',
 timestamp:'Synchronize the device clock; transmit a fresh frame within the replay window.',
 identity:'Check the device key ID and gateway database connection.',
 authentication:'Use the current API secret as 64 ASCII characters. Check key rotation and packet corruption.',
 schema:'Publish this schema version for the device before sending.',
 decryption:'Check the encryption setting/key and exact encoded payload length.',
 payload:'Check the encoded payload length against the selected schema version.',
 decoding:'Use the generated encoder for this immutable schema version.',
 storage:'Check database availability and migrations. A nonce or event ID must not identify different data.',
 acknowledgment:'Storage may have committed even when the receipt was lost. Retry with the same event identity.',
}
class Trace {
 constructor(transport,bytes,mode='production'){
  this.data={format:'struct-diagnostic-v1',id:randomUUID(),mode,transport,started_at:new Date().toISOString(),frame_bytes:bytes,stages:[],device_outcome:'not observed'}
  this.start=performance.now()
 }
 begin(stage){this.finish();this.current={stage,status:'running',at_ms:Math.round(performance.now()-this.start)};this.data.stages.push(this.current)}
 finish(){if(this.current?.status==='running')this.current.status='passed'}
 fail(){if(this.current){this.current.status='failed';this.current.explanation=explanations[this.current.stage]||'Inspect gateway configuration and retry safely.'}this.data.outcome='failed'}
 complete(){this.finish();this.data.outcome='processed';this.data.elapsed_ms=Math.round(performance.now()-this.start)}
 bytes(payload,encrypted,queued,confirmed){this.data.bytes={payload,protocol:66,event_identity:queued?16:0,encryption:encrypted?32:0,acknowledgment:confirmed?69:0,transport_per_datagram_ipv4:28,transport_per_datagram_ipv6:48,transport_note:this.data.transport==='udp'?'IP + UDP headers; excludes link layer, radio attach, retransmissions and fragmentation':'TCP overhead depends on segmentation, options and handshake; UDP estimates do not apply'}}
}
// Allowlisted values only. Never serialize an exception, device object or frame.
let pending=0
async function persistTrace(db,trace){
 if(!trace.device?.organization_id || !trace.device?.debug_trace_until || Date.parse(trace.device.debug_trace_until)<=Date.now())return
 if(pending>=32)return // Bound diagnostic work; telemetry never waits for it.
 pending++
 try{const {error}=await db.rpc('record_packet_trace',{p_device_id:trace.device.id,p_trace:trace.data});if(error)console.warn('[struct] Diagnostic persistence unavailable')}catch{console.warn('[struct] Diagnostic persistence unavailable')}finally{pending--}
}
module.exports={Trace,persistTrace}

<template>
 <section class="space-y-4">
  <div class="flex flex-wrap gap-3">
   <label class="label">Source
    <select v-model="mode" class="input"><option value="production">Production gateway</option><option value="local">Local gateway / fault tests</option><option value="simulation">Simulation — no transmission</option></select>
   </label>
  </div>
  <LiveDebugger v-if="mode==='simulation'" :devices="devices" :schemas="schemas" />
  <template v-else>
   <p class="text-sm text-[#8B93A7]">{{ mode==='production'?'Traces follow real gateway processing. Capture lasts 15 minutes and retains the latest 200 attempts per device. Missing traces do not prove packet loss.':'Run the local command in your Struct checkout, then open its diagnostic file. UDP, SDK cryptography, PostgreSQL transactions and HTTP delivery are real; faults are injected.' }}</p>
   <div v-if="mode==='production'" class="flex flex-wrap gap-3">
    <select v-model="deviceId" class="input" aria-label="Trace device"><option value="">Select device</option><option v-for="device in devices" :key="device.id" :value="device.id">{{device.name}}</option></select>
    <button class="btn-primary" :disabled="!deviceId||busy||!canWrite" @click="enable">Capture for 15 minutes</button>
    <button class="btn-ghost" :disabled="!deviceId||busy" @click="refresh">Refresh traces</button>
   </div>
   <div v-else class="flex flex-wrap gap-3">
    <select v-model="scenario" class="input" aria-label="Local scenario"><option v-for="s in scenarios" :key="s">{{s}}</option></select>
   </div>
   <div class="card space-y-2 p-4">
    <p class="text-sm">{{mode==='local'?'Reproduce with generated local credentials:':'Send a real encoded payload; configure credentials through environment variables:'}}</p>
    <code class="block break-all text-xs">{{command}}</code><button class="btn-ghost" @click="copyCommand">Copy command</button>
    <p v-if="mode==='production'" class="text-xs text-[#8B93A7]">Set STRUCT_HOST, STRUCT_KEY_ID, STRUCT_API_SECRET, and STRUCT_ENCRYPTION_KEY for encrypted devices. Never put credentials in shared commands.</p>
    <label class="label">{{mode==='local'?'Open local diagnostic JSON':'Attach SDK outcome JSON to match a packet fingerprint'}}<input type="file" accept=".json" @change="importFile" /></label>
   </div>
   <p v-if="error" role="alert" class="text-red-400">{{error}}</p><p v-if="notice" role="status" class="text-sm">{{notice}}</p>
   <p v-if="!traces.length" class="text-sm">No traces loaded. Enable capture before sending, or import a local diagnostic.</p>
   <article v-for="(trace,index) in traces" :key="trace.id||index" class="card space-y-3 p-4">
    <h3 class="font-semibold">{{trace.mode}} · {{trace.outcome||trace.fault||'attempt'}} · {{trace.started_at}}</h3>
    <p class="break-all font-mono text-xs">Packet fingerprint: {{trace.packet_id||'unavailable'}}</p>
    <p class="text-sm">Device: {{deviceOutcome(trace)}} · Gateway acknowledgment: {{trace.acknowledgment||'none observed'}}</p>
    <p v-if="trace.replay" class="text-sm">Replay check: {{trace.replay}}</p>
    <ul class="space-y-1 text-sm"><li v-for="stage in trace.stages" :key="stage.stage" :class="stage.status==='failed'?'text-red-300':'text-emerald-200'"><strong>{{stage.stage}}: {{stage.status}}</strong> · {{stage.at_ms}} ms <span v-if="stage.explanation">— {{stage.explanation}}</span></li></ul>
    <p v-if="trace.bytes" class="text-sm">Payload {{trace.bytes.payload}} B · protocol {{trace.bytes.protocol}} B · stable event ID {{trace.bytes.event_identity}} B · encryption {{trace.bytes.encryption}} B · receipt {{trace.bytes.acknowledgment}} B</p>
    <p v-if="trace.bytes" class="text-xs text-[#8B93A7]">{{trace.bytes.transport_note}}. UDP transport: 28 B IPv4 or 48 B IPv6 per datagram. Receipt bytes are separate from the uplink.</p>
    <p class="text-sm">Webhooks: {{webhookSummary(trace.event_id)}}</p>
   </article>
   <button v-if="traces.length" class="btn-primary" @click="download">Download sanitized diagnostic bundle</button>
  </template>
 </section>
</template>
<script setup lang="ts">
import type {Device,DeviceSchema} from '~/types'
import {sanitizeTrace,sanitizeOutcome,sanitizeWebhook} from '~/utils/diagnostic'
const props=defineProps<{devices:Device[],schemas:Record<string,DeviceSchema>}>()
const db=useSupabaseClient(),{canWrite,currentOrgId}=useOrganization()
const mode=ref('production'),deviceId=ref(''),scenario=ref('encrypted'),busy=ref(false),error=ref(''),notice=ref('')
const traces=ref<any[]>([]),webhooks=ref<any[]>([]),outcomes=ref<any[]>([])
const scenarios=['success','encrypted','malformed','authentication','duplicate','packet-loss','timeout','retry','schema','storage','webhook-retry']
const command=computed(()=>mode.value==='local'?`node scripts/debug-local.cjs --scenario ${scenario.value} --output struct-diagnostic.json`:'node scripts/debug-send.cjs payload.bin 1 struct-device-outcome.json')
let generation=0
function clear(){generation++;traces.value=[];webhooks.value=[];outcomes.value=[];error.value='';notice.value='';busy.value=false}
watch([mode,deviceId,currentOrgId],clear)
async function enable(){try{busy.value=true;const {error:e}=await db.rpc('enable_packet_tracing',{p_device_id:deviceId.value});if(e)throw e;notice.value='Capture enabled. Send an SDK packet, then refresh.'}catch{error.value='Could not enable capture. Check organization permissions and migration 025.'}finally{busy.value=false}}
async function refresh(){
 const run=++generation;busy.value=true;error.value=''
 try{
  const result=await db.from('packet_traces').select('trace').eq('device_id',deviceId.value).order('created_at',{ascending:false}).limit(200)
  if(result.error)throw result.error;if(run!==generation)return
  traces.value=(result.data||[]).map((r:any)=>sanitizeTrace(r.trace))
  const ids=[...new Set(traces.value.map(t=>t.event_id).filter(Boolean))]
  webhooks.value=[]
  if(ids.length){const jobs=await db.from('webhook_deliveries').select('event_id,status,attempts').in('event_id',ids).limit(1000);if(jobs.error)throw jobs.error;if(run===generation)webhooks.value=jobs.data||[]}
 }catch{if(run===generation)error.value='Could not load gateway traces or webhook status. Check connection and migration 025.'}finally{if(run===generation)busy.value=false}
}
function deviceOutcome(t:any){const result=t.packet_id&&outcomes.value.find(o=>o.packet_id===t.packet_id&&o.status);return result?`${result.status} (${result.attempts} send attempts)`:'not observed — attach SDK result'}
function webhookSummary(id:string){if(!id)return 'no correlated stored event';const jobs=webhooks.value.filter(j=>j.event_id===id);return jobs.length?jobs.map(j=>`${j.status} (${j.attempts} attempts)`).join(', '):'no jobs observed; refresh or inspect delivery history'}
async function importFile(event:Event){
 const file=(event.target as HTMLInputElement).files?.[0];if(!file)return
 const run=generation
 try{
  if(file.size>2_000_000)throw new Error()
  const data=JSON.parse(await file.text());if(run!==generation)return
  if(mode.value==='local'&&data.format==='struct-diagnostic-v1'&&data.mode==='local'&&Array.isArray(data.traces)&&data.traces.length<=200){traces.value=data.traces.map(sanitizeTrace);webhooks.value=(data.webhooks||[]).slice(0,1000).map(sanitizeWebhook);outcomes.value=(data.device_outcome?[data.device_outcome]:(data.device_outcomes||[])).slice(0,200).map(sanitizeOutcome);if(scenarios.includes(data.scenario))scenario.value=data.scenario}
  else if(mode.value==='production'&&data.format==='struct-device-outcome-v1'&&/^[a-f0-9]{64}$/.test(data.packet_id)){outcomes.value.push(sanitizeOutcome(data))}
  else throw new Error()
 }catch{error.value='Invalid diagnostic file or wrong source mode. Use a file generated by the debugger commands.'}
}
async function copyCommand(){try{await navigator.clipboard.writeText(command.value);notice.value='Command copied'}catch{error.value='Clipboard unavailable; select and copy the command.'}}
function download(){
 // Explicit allowlist even for imported files. Never re-export arbitrary JSON.
 const clean=traces.value.map(sanitizeTrace)
 const blob=new Blob([JSON.stringify({format:'struct-diagnostic-v1',mode:mode.value,scenario:mode.value==='local'?scenario.value:undefined,traces:clean,webhooks:webhooks.value.map(j=>({event_id:j.event_id,status:j.status,attempts:j.attempts})),device_outcomes:outcomes.value.map(o=>({packet_id:o.packet_id,status:o.status,attempts:o.attempts,elapsedMs:o.elapsedMs})),reproduction:command.value},null,2)],{type:'application/json'})
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='struct-diagnostic.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
 notice.value='Diagnostic download requested. Your browser may ask where to save it.'
}
</script>

<template>
 <section class="space-y-4" aria-labelledby="secure-v2-title">
  <div class="card p-5 space-y-3">
   <div><h2 id="secure-v2-title" class="text-base font-semibold">Struct Secure V2</h2><p class="mt-1 text-sm text-[#9AA3B2]">Encrypted telemetry with a 25-byte security envelope. Enrollment adds Secure V2 while your existing firmware continues working.</p></div>
   <label class="label" for="secure-v2-device">Device</label>
   <select id="secure-v2-device" v-model="deviceId" class="input"><option value="" disabled>Select device</option><option v-for="device in devices" :key="device.id" :value="device.id">{{device.name}}</option></select>
   <p v-if="loading" role="status" class="text-sm">Loading Secure V2 configuration…</p>
   <div v-else-if="deviceId" class="space-y-3">
    <p v-if="state?.available===false" role="status" class="text-sm text-[#9AA3B2]">Secure V2 is not enabled on this deployment yet. Your existing firmware continues working.</p>
    <p v-else class="text-sm">{{state?.enabled?'Secure V2 enrolled':'Secure V2 has not been enrolled'}}<span v-if="state?.wireDeviceId" class="font-mono"> · wire ID {{state.wireDeviceId}}</span></p>
    <div v-if="canWrite && state?.available" class="flex flex-wrap gap-3">
     <button v-if="!state?.enabled" class="btn-primary" :disabled="busy||!loaded" @click="credentialAction('enroll')">{{busy?'Working…':'Enroll Secure V2'}}</button>
     <template v-else><button class="btn-ghost" :disabled="busy" @click="rotationVisible=!rotationVisible">Rotate device secret</button><span class="text-xs text-[#9AA3B2]">Secret ending {{state.secretPreview||'••••'}}</span></template>
    </div>
    <div v-if="rotationVisible" class="rounded-lg border border-amber-500/30 p-4 space-y-3">
     <p class="text-sm">Rotation issues a new secret and wire ID. Reflash this device with the new project. Existing slots stay available.</p>
     <label class="label" for="secure-v2-grace">Previous firmware grace period</label><select id="secure-v2-grace" v-model.number="graceSeconds" class="input"><option :value="0">Revoke previous credential immediately</option><option :value="3600">1 hour</option><option :value="86400">24 hours</option></select>
     <button class="btn-primary" :disabled="busy" @click="credentialAction('rotate')">Issue replacement credential</button>
    </div>
   </div>
   <p v-if="!canWrite" class="text-sm text-[#9AA3B2]">An owner or admin can enroll devices, publish slots, and export private firmware projects.</p>
  </div>
  <div v-if="credentials" class="card p-5 space-y-3">
   <h3 class="font-semibold">Save the device secret</h3><p class="text-sm text-[#9AA3B2]">Keep this secret private. One credential belongs to one physical device. The project download fills in the private configuration automatically.</p>
   <label class="label" for="secure-v2-secret">Device root secret</label><input id="secure-v2-secret" readonly :value="credentials.rootSecret" class="input font-mono text-xs" @focus="($event.target as HTMLInputElement).select()" />
   <div class="flex gap-3"><button class="btn-ghost" @click="copySecret">Copy secret</button><button class="btn-ghost" @click="credentials=null">Hide secret</button></div>
  </div>
  <template v-if="state?.enabled">
   <div class="card p-5 space-y-4">
    <h3 class="font-semibold">Immutable schema slots</h3><p class="text-sm text-[#9AA3B2]">A slot always means the same layout. Publish changes into an unused slot so older firmware keeps decoding correctly.</p>
    <ul v-if="state.slots.length" class="space-y-2"><li v-for="slot in state.slots" :key="slot.slot" class="rounded-lg border border-white/10 p-3 text-sm"><span class="font-mono">Slot {{slot.slot}}</span> · {{slot.encoding}} · {{slot.record_bytes}} B payload · {{slot.record_bytes+25}} B secure frame <span v-if="slot.legacy_schema_version">· legacy v{{slot.legacy_schema_version}}</span><span v-if="slot.sample_interval_ms"> · {{slot.sample_interval_ms}} ms interval</span></li></ul>
    <p v-else class="text-sm">Publish the first slot before downloading a project.</p>
    <template v-if="canWrite">
     <div class="grid gap-3 sm:grid-cols-2"><div><label class="label" for="secure-v2-slot">New unused slot</label><select id="secure-v2-slot" v-model.number="newSlot" class="input" :disabled="!unusedSlots.length"><option v-for="slot in unusedSlots" :key="slot" :value="slot">Slot {{slot}}</option></select></div><div><label class="label" for="secure-v2-encoding">Payload encoding</label><select id="secure-v2-encoding" v-model="encoding" class="input"><option value="bitpacked-v1">Optimized bit-packed fields</option><option value="legacy-le-v1" :disabled="!legacySchema?.schema_definition.length">Preserve published legacy schema</option></select></div></div>
     <template v-if="encoding==='bitpacked-v1'">
      <div class="flex flex-wrap gap-3"><button class="btn-ghost text-xs" @click="environmentalExample">Use environmental example</button><button class="btn-ghost text-xs" @click="fields.push(packedFieldDefault(`field_${fields.length}`,'boolean'))">Add field</button></div>
      <div v-for="(field,index) in fields" :key="index" class="rounded-lg border border-white/10 p-3 space-y-3">
       <div class="grid gap-2 sm:grid-cols-[1fr_150px_auto]"><input v-model="field.name" :aria-label="`Packed field ${index+1} name`" class="input font-mono" /><select :value="field.type" :aria-label="`Packed field ${index+1} type`" class="input" @change="changeType(index,($event.target as HTMLSelectElement).value)"><option v-for="type in PACKED_TYPES" :key="type" :value="type">{{type}}</option></select><button class="btn-ghost" :aria-label="`Remove field ${index+1}`" @click="fields.splice(index,1)">Remove</button></div>
       <div v-if="field.type==='fixed'" class="grid gap-2 sm:grid-cols-3"><label class="label">Minimum<input v-model.number="field.min" type="number" step="any" class="input" /></label><label class="label">Maximum<input v-model.number="field.max" type="number" step="any" class="input" /></label><label class="label">Precision<input v-model.number="field.precision" type="number" step="any" min="0" class="input" /></label><label class="flex items-center gap-2 text-xs sm:col-span-3"><input v-model="field.clamp" type="checkbox" />Explicitly clamp out-of-range values (otherwise encoding fails)</label></div>
       <label v-if="['uint','int','bitset'].includes(field.type)" class="label">Bit width (1–32)<input v-model.number="field.width" type="number" min="1" max="32" class="input max-w-32" /></label>
       <label v-if="field.type==='enum'" class="label">Ordered labels, separated by commas<input :value="field.values?.join(', ')" class="input" @input="field.values=($event.target as HTMLInputElement).value.split(',').map(value=>value.trim())" /></label>
      </div>
      <p class="text-xs text-[#9AA3B2]">Fixed fields deliberately trade precision for size. Float32 preserves its declared floating-point format. No published legacy field changes automatically.</p>
     </template>
     <p v-else class="text-sm">This slot copies the existing published schema v{{legacySchema?.version}} exactly, including little-endian floats and one-byte booleans.</p>
     <label class="label" for="secure-v2-interval">Optional fixed sample interval (milliseconds)</label><input id="secure-v2-interval" v-model="sampleInterval" type="number" min="1" step="1" class="input max-w-xs" placeholder="Server acceptance time when blank" />
     <p v-if="schemaError" class="text-sm text-amber-300">{{schemaError}}</p><p v-else class="text-sm">{{previewBytes}} B payload · {{previewBytes+25}} B Struct frame · {{previewBytes+53}} B estimated IPv4 + UDP</p>
     <button class="btn-primary" :disabled="busy||!!schemaError||!unusedSlots.length" @click="publishSlot">Publish immutable slot</button><p v-if="!unusedSlots.length" class="text-sm text-amber-300">All sixteen slots are used. Create a new device configuration to make further layout changes.</p>
    </template>
   </div>
   <div class="card p-5 space-y-4">
    <h3 class="font-semibold">Download a complete ESP32 project</h3><p class="text-sm text-[#9AA3B2]">Includes firmware, the generated encoder, private device configuration, pinned SDK source, and a first-run guide. Enter Wi-Fi credentials, build, and upload.</p>
    <div class="grid gap-3 sm:grid-cols-2"><div><label class="label" for="secure-v2-export-slot">Firmware schema slot</label><select id="secure-v2-export-slot" v-model.number="exportSlot" class="input"><option v-for="slot in state.slots" :key="slot.slot" :value="slot.slot">Slot {{slot.slot}} · {{slot.encoding}}</option></select></div><div><label class="label" for="secure-v2-board">ESP32 board</label><select id="secure-v2-board" v-model="board" class="input"><option value="esp32-c3-devkitm-1">ESP32-C3 DevKitM-1</option><option value="esp32dev">ESP32 Dev Module</option></select></div></div>
    <label class="flex items-center gap-2 text-sm"><input v-model="confirmed" type="checkbox" />Request an authenticated storage receipt and bounded retries</label>
    <button v-if="canWrite" class="btn-primary" :disabled="busy||!state.slots.length" @click="downloadProject">{{busy?'Preparing…':'Download private PlatformIO project'}}</button>
    <p class="text-xs text-[#9AA3B2]">Preserve NVS counter state across reboots. Erasing NVS or restoring an old flash backup requires credential rotation. Never flash this project onto multiple devices.</p>
   </div>
  </template>
  <p v-if="error" role="alert" class="text-sm text-red-300">{{error}}</p><p v-if="notice" role="status" class="text-sm text-emerald-200">{{notice}}</p>
 </section>
</template>
<script setup lang="ts">
import type {Device,DeviceSchema} from '~/types'
import {ENVIRONMENTAL_PACKED,PACKED_TYPES,packedFieldDefault,slotRecordBytes,type PackedField,type SecureV2Encoding,type SecureV2Slot} from '#shared/secureV2Schema'
import {generateSecureV2Project,embedSecureV2Sdk,type SecureV2Board,type SecureV2ProjectCredentials} from '#shared/secureV2Project'
const props=defineProps<{devices:Device[],schemas:Record<string,DeviceSchema>}>()
const {currentOrgId,canWrite}=useOrganization()
const deviceId=useState('schema-selected-device',()=>''),state=ref<{available:boolean,enabled:boolean,wireDeviceId?:number|null,secretPreview?:string|null,slots:SecureV2Slot[]}|null>(null)
const credentials=ref<SecureV2ProjectCredentials|null>(null),loading=ref(false),loaded=ref(false),busy=ref(false),error=ref(''),notice=ref('')
const fields=ref<PackedField[]>(structuredClone(ENVIRONMENTAL_PACKED)),encoding=ref<SecureV2Encoding>('bitpacked-v1'),newSlot=ref(0),exportSlot=ref(0),sampleInterval=ref('')
const rotationVisible=ref(false),graceSeconds=ref(0),board=ref<SecureV2Board>('esp32-c3-devkitm-1'),confirmed=ref(false)
let generation=0
const unusedSlots=computed(()=>Array.from({length:16},(_,i)=>i).filter(i=>!state.value?.slots.some(s=>s.slot===i)))
const legacySchema=computed(()=>props.schemas[deviceId.value])
const schemaError=computed(()=>{try{slotRecordBytes(encoding.value==='bitpacked-v1'?fields.value:legacySchema.value?.schema_definition||[],encoding.value);return ''}catch(e:any){return e.message}})
const previewBytes=computed(()=>schemaError.value?0:slotRecordBytes(encoding.value==='bitpacked-v1'?fields.value:legacySchema.value!.schema_definition,encoding.value))
function failure(e:any){return e?.data?.message||e?.data?.statusMessage||e?.message||'Secure V2 is unavailable. Check rollout configuration and database migrations.'}
async function load(){
 const run=++generation;state.value=null;credentials.value=null;error.value='';notice.value='';rotationVisible.value=false;loaded.value=false
 if(!deviceId.value||!currentOrgId.value){loading.value=false;return false}
 loading.value=true
 try{const result=await $fetch<any>(`/api/devices/${deviceId.value}/secure-v2`,{query:{orgId:currentOrgId.value}});if(run!==generation)return;state.value=result;loaded.value=true;newSlot.value=unusedSlots.value[0]??0;exportSlot.value=result.slots[0]?.slot??0;return true}catch(e){if(run===generation)error.value=failure(e);return false}finally{if(run===generation)loading.value=false}
}
watch([deviceId,currentOrgId],load,{immediate:true})
watch(()=>props.devices,devices=>{if(!deviceId.value&&devices.length)deviceId.value=devices[0]!.id},{immediate:true})
function environmentalExample(){fields.value=structuredClone(ENVIRONMENTAL_PACKED)}
function changeType(index:number,type:string){const f=fields.value[index];if(f)fields.value[index]=packedFieldDefault(f.name,type as PackedField['type'])}
async function credentialAction(action:'enroll'|'rotate'){
 if(busy.value||!canWrite.value)return;const run=generation;busy.value=true;error.value='';notice.value=''
 try{const result=await $fetch<any>(`/api/devices/${deviceId.value}/secure-v2`,{method:'POST',body:{orgId:currentOrgId.value,action,graceSeconds:action==='rotate'?graceSeconds.value:0}});if(run!==generation)return;if(!await load())return;credentials.value=result.credentials;notice.value='Save this secret, publish a slot, then download the firmware project.'}catch(e){if(run===generation)error.value=failure(e)}finally{busy.value=false}
}
async function publishSlot(){
 if(busy.value||!canWrite.value)return;const run=generation;busy.value=true;error.value='';notice.value=''
 try{const interval=sampleInterval.value===''?undefined:Number(sampleInterval.value);if(interval!==undefined&&(!Number.isInteger(interval)||interval<1))throw new Error('Sample interval must be a positive integer')
 await $fetch(`/api/devices/${deviceId.value}/secure-v2/slots`,{method:'POST',body:{orgId:currentOrgId.value,slot:newSlot.value,encoding:encoding.value,schemaDefinition:encoding.value==='bitpacked-v1'?fields.value:legacySchema.value!.schema_definition,legacySchemaVersion:encoding.value==='legacy-le-v1'?legacySchema.value!.version:undefined,sampleIntervalMs:interval}})
 if(run!==generation)return;const published=newSlot.value;const savedCredentials=credentials.value;if(!await load())return;credentials.value=savedCredentials;exportSlot.value=published;notice.value=`Slot ${published} published. Its meaning cannot be changed.`
 }catch(e){if(run===generation)error.value=failure(e)}finally{busy.value=false}
}
async function copySecret(){try{if(credentials.value)await navigator.clipboard.writeText(credentials.value.rootSecret);notice.value='Device secret copied'}catch{error.value='Clipboard unavailable. Select the secret and copy it manually.'}}
async function downloadProject(){
 if(busy.value||!canWrite.value)return;const run=generation;busy.value=true;error.value='';notice.value=''
 try{
  const {zipSync,unzipSync,strToU8}=await import('fflate')
  const response=await fetch('/sdk/struct-sdk.zip');if(!response.ok)throw new Error('SDK download is unavailable')
  const archive=unzipSync(new Uint8Array(await response.arrayBuffer()));if(run!==generation)return
  const result=await $fetch<any>(`/api/devices/${deviceId.value}/secure-v2/project`,{method:'POST',body:{orgId:currentOrgId.value}});if(run!==generation)return
  const slot=(result.slots as SecureV2Slot[]).find(s=>s.slot===exportSlot.value);if(!slot)throw new Error('Selected slot is unavailable; refresh configuration')
  const files=generateSecureV2Project({slot,credentials:result.credentials,board:board.value,confirmed:confirmed.value})
  const project=embedSecureV2Sdk(Object.fromEntries(Object.entries(files).map(([name,source])=>[name,strToU8(source)])),archive)
  const blob=new Blob([zipSync(project)],{type:'application/zip'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='struct-secure-v2-esp32.zip';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
  credentials.value=null;notice.value='Private project downloaded. Enter Wi-Fi credentials in include/struct_config.h, then build and upload.'
 }catch(e){if(run===generation)error.value=failure(e)}finally{busy.value=false}
}
onBeforeUnmount(()=>{generation++;credentials.value=null})
</script>

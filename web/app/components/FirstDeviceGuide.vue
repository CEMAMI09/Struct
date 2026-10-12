<template>
<section class="card p-5" aria-labelledby="first-device-title">
 <div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-xs text-[#b79bff]">Getting Started</p><h2 id="first-device-title" class="mt-1 font-semibold">Send your first Secure V2 reading</h2><p class="mt-2 text-sm text-[#9AA3B2]">Verified workspace progress survives telemetry retention. Downloads and configuration are separate from successful storage.</p></div><button v-if="canWrite" class="btn-ghost text-xs" @click="$emit('dismiss')">Dismiss guide</button></div>
 <ol class="mt-4 grid gap-3 lg:grid-cols-2">
  <li v-for="(step,i) in steps" :key="step.title" class="rounded-lg border border-white/10 p-4"><h3 class="text-sm font-medium"><span class="mr-2 text-[#b79bff]" aria-hidden="true">{{step.done?'✓':i+1}}</span>{{step.title}} <span class="text-xs text-[#9AA3B2]">{{step.done?'Complete':step.evidence}}</span></h3><p class="mt-2 text-xs leading-5 text-[#9AA3B2]">{{step.detail}}</p><NuxtLink :to="step.to" class="mt-3 inline-block text-xs text-[#b79bff]">{{step.action}}</NuxtLink></li>
 </ol>
 <details class="mt-4 text-sm"><summary class="cursor-pointer text-[#b79bff]">Build, upload and troubleshoot</summary><p class="mt-2 text-[#9AA3B2]">ESP32: extract the whole project, enter Wi-Fi credentials in include/struct_config.h, and use the PlatformIO terminal. Node: extract the starter and run node send.cjs. Use a separate device credential for each sender.</p><DocCode code="pio device list
pio run
pio run -t upload --upload-port COM3
pio device monitor --baud 115200 --port COM3"/><p class="mt-2 text-xs text-[#9AA3B2]">COM3 is an example; use your board’s actual port. Confirmed result 3 / committed means stored. Unknown means check telemetry and diagnostics; never erase counter state to retry.</p><NuxtLink to="/docs/troubleshooting" class="text-[#b79bff]">Troubleshooting by symptom</NuxtLink></details>
 <div v-if="deviceId && canWrite" class="mt-4"><label class="label" for="expected-report">Expected transmission interval (seconds, optional)</label><input id="expected-report" v-model="interval" class="input max-w-xs" type="number" min="1" max="604800" placeholder="Default activity window: 5 minutes"/><button class="btn-ghost mt-2 text-xs" :disabled="saving" @click="saveInterval">Save activity expectation</button></div>
 <button v-if="deviceId && downloaded && !configured && canWrite" class="btn-ghost mt-4 text-xs" :disabled="saving" @click="markConfigured">{{saving?'Saving…':'I configured this starter (manual)'}}</button><p v-if="error" role="alert" class="mt-2 text-sm text-red-300">{{error}}</p>
 <p class="mt-3 text-xs text-[#9AA3B2]">Firmware upload is not automatically detected. A storage receipt does not prove that a webhook reached your backend.</p>
</section>
</template>
<script setup lang="ts">
const props=defineProps<{deviceId?:string|null;hasDevice:boolean;hasSchema:boolean;hasTelemetry:boolean;hasVisibleTelemetry?:boolean;configured?:boolean;downloaded?:boolean;canWrite:boolean;expectedIntervalMs?:number|null}>()
defineEmits<{dismiss:[]}>()
const onboarding=useOnboarding()
const deviceStore=useDevices()
const saving=ref(false),error=ref(''),manual=ref(false),interval=ref('')
watch(()=>[props.deviceId,props.expectedIntervalMs],()=>{manual.value=false;interval.value=props.expectedIntervalMs?String(props.expectedIntervalMs/1000):''},{immediate:true})
async function saveInterval(){if(!props.deviceId||saving.value)return;saving.value=true;error.value='';try{const n=interval.value===''?null:Number(interval.value)*1000;if(n!==null&&(!Number.isInteger(n)||n<1000||n>604800000))throw new Error('Enter an interval from 1 to 604800 seconds');await onboarding.markDevice(props.deviceId,'interval',n);await deviceStore.fetchDevices({force:true})}catch(e:any){error.value=e.message}finally{saving.value=false}}
const schemaUrl=computed(()=>props.deviceId?`/dashboard/schema?device=${encodeURIComponent(props.deviceId)}`:'/dashboard/schema')
const steps=computed(()=>[
 {title:'Create a device',done:props.hasDevice,evidence:'Verified',detail:'One device represents one sender. Secure V2 enrollment is automatic for new devices.',to:'/dashboard/devices?create=1',action:'Open devices'},
 {title:'Publish a schema',done:props.hasSchema,evidence:'Verified',detail:'Choose the environmental example or define fields, bounds and precision. Publish an unused immutable slot.',to:schemaUrl.value,action:'Configure schema'},
 {title:'Download and configure',done:!!props.downloaded&&(!!props.configured||manual.value),evidence:'Download recorded; configuration manual',detail:'Choose ESP32 / PlatformIO or Node.js without hardware. The private ZIP includes SDK, encoder, sample values and instructions.',to:schemaUrl.value,action:'Choose platform and download'},
 {title:'Receive and inspect telemetry',done:props.hasTelemetry,evidence:'Verified by committed storage',detail:props.hasTelemetry&&!props.hasVisibleTelemetry?'A valid reading was stored previously. Its history may have expired; send again to inspect current data.':'Run the starter, then select this device in Overview. Inspect Latest stored event; use Diagnostics if no reading appears.',to:props.deviceId?`/dashboard?device=${props.deviceId}`:'/dashboard',action:'View telemetry'},
])
async function markConfigured(){if(!props.deviceId||saving.value)return;saving.value=true;error.value='';try{await onboarding.markDevice(props.deviceId,'configured');manual.value=true;await deviceStore.fetchDevices({force:true})}catch(e:any){error.value=e.message}finally{saving.value=false}}
</script>

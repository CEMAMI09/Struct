<template>
  <main class="mx-auto max-w-5xl space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div><h1 class="text-xl font-semibold">Delivery history</h1>
      <p class="text-sm text-[#8B93A7]">Retries keep the same event ID. Receivers must deduplicate it.</p></div>
      <button class="btn-primary" :disabled="loading" @click="load">Refresh</button>
    </div>
    <p v-if="error" role="alert" class="text-red-400">{{ error }}</p>
    <section class="card space-y-2 p-4">
      <h2 class="font-semibold">Device commands</h2>
      <p class="text-sm text-[#8B93A7]">Received means accepted by the device; executed means the handler reported completion. Unknown may have executed.</p>
      <p v-if="!commands.length" class="text-sm">No commands yet.</p>
      <p v-for="command in commands" :key="command.id" class="break-all text-sm">{{ command.command_type }} · {{ command.status }} · {{ command.command_id }} · expires {{ command.expires_at }}</p>
    </section>
    <h2 class="font-semibold">Telemetry webhooks</h2>
    <p v-if="!loading && !jobs.length" class="text-[#8B93A7]">No delivery jobs in this organization yet.</p>
    <article v-for="job in jobs" :key="job.id" class="card space-y-2 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <strong>{{ job.status }} · {{ job.attempts }} attempts</strong>
        <button v-if="job.status === 'dead' && canWrite" class="btn-ghost" :disabled="loading || job.replay_count >= 3" @click="replay(job.id)">Replay same event</button>
      </div>
      <p class="break-all text-sm">{{ job.destination_url }}</p>
      <p class="break-all font-mono text-xs">Event {{ job.event_id }}</p>
      <p class="text-xs text-[#8B93A7]">{{ job.created_at }} · {{ job.last_error || 'No error recorded' }}</p>
      <button class="btn-ghost" @click="showAttempts(job.id)">View attempts</button>
      <ul v-if="selected === job.id" class="space-y-1 text-sm">
        <li v-for="attempt in attempts" :key="attempt.id">{{ attempt.attempted_at }} — {{ attempt.outcome }}: {{ attempt.detail }}</li>
      </ul>
    </article>
  </main>
</template>
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const supabase=useSupabaseClient()
const {currentOrgId,ensureOrganization,canWrite}=useOrganization()
const jobs=ref<any[]>([]),attempts=ref<any[]>([]),selected=ref(''),loading=ref(false),error=ref('')
const commands=ref<any[]>([])
let generation=0
async function load(){
 const run=++generation;loading.value=true;error.value='';jobs.value=[];commands.value=[];attempts.value=[];selected.value=''
 try{await ensureOrganization();const org=currentOrgId.value;if(!org)return
 const {data,error:err}=await supabase.from('webhook_deliveries').select('id,event_id,destination_url,status,attempts,replay_count,created_at,last_error').eq('organization_id',org).order('created_at',{ascending:false}).limit(100)
 if(err)throw err;if(run===generation)jobs.value=data||[]
 const commandResult=await supabase.from('pending_commands').select('id,command_id,command_type,status,expires_at,devices!inner(organization_id)').eq('devices.organization_id',org).order('created_at',{ascending:false}).limit(100)
 if(commandResult.error)throw commandResult.error;if(run===generation)commands.value=commandResult.data||[]
 }catch(e:any){if(run===generation)error.value=e.message||'Unable to load delivery history'}finally{if(run===generation)loading.value=false}
}
async function showAttempts(id:string){
 const run=generation;selected.value=id;attempts.value=[]
 const {data,error:err}=await supabase.from('webhook_attempts').select('id,attempted_at,outcome,detail').eq('delivery_id',id).order('attempted_at',{ascending:false}).limit(40)
 if(run!==generation||selected.value!==id)return
 if(err)error.value=err.message;else attempts.value=data||[]
}
async function replay(id:string){
 loading.value=true
 const {error:err}=await supabase.rpc('replay_webhook_delivery',{p_id:id})
 if(err){error.value=err.message;loading.value=false;return}await load()
}
watch(currentOrgId,()=>{void load()})
onMounted(load)
</script>

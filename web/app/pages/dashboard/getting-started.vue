<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <FirstDeviceGuide
      :device-id="device?.id" :has-device="!!device"
      :has-schema="!!device && !!onboarding.state.value?.schema_device_ids?.includes(device.id)"
      :has-telemetry="!!device?.first_telemetry_at"
      :downloaded="!!device?.starter_downloaded_at"
      :expected-interval-ms="device?.expected_report_interval_ms"
      :configured="!!device?.configuration_acknowledged_at"
      :can-write="canWrite" @dismiss="dismiss"
    />
    <p v-if="error || onboarding.error.value" role="alert" class="text-red-300">{{error || onboarding.error.value}}</p>
    <NuxtLink to="/docs/getting-started" class="text-[#b79bff]">Full first-packet documentation</NuxtLink>
  </div>
</template>
<script setup lang="ts">
definePageMeta({middleware:'auth'})
const route=useRoute(),store=useDevices(),onboarding=useOnboarding(),{canWrite}=useOrganization()
const error=ref('')
const device=computed(()=>store.devices.value.find(d=>d.id===route.query.device)||store.devices.value[0])
let timer:ReturnType<typeof setInterval>|undefined
async function refresh(){await Promise.all([store.fetchDevices({force:true}),onboarding.refresh()])}
onMounted(async()=>{
  await refresh()
  timer=setInterval(()=>{if(!document.hidden&&!device.value?.first_telemetry_at)void refresh()},30000)
})
onBeforeUnmount(()=>clearInterval(timer))
async function dismiss(){try{await onboarding.dismiss();await navigateTo('/dashboard')}catch(e:any){error.value=e.message}}
</script>

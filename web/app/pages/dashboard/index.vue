<template>
  <div class="flex min-h-0 flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-[#E8EAEF]">
          {{ deviceHeading }}
        </p>
        <p class="mt-1 text-xs text-[#9AA3B2]">
          Latest stored samples for this device, up to 50, within the
          {{ telemetryRetentionDays }}-day window.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="selectedId" class="text-xs text-[#9AA3B2]" role="status">
          {{ connectionStatus === 'connected' ? 'Live updates connected' : connectionStatus === 'connecting' ? 'Connecting live updates…' : 'Live updates unavailable; use Refresh' }}
        </span>
        <button type="button" class="btn-ghost shrink-0 text-xs" :disabled="refreshing" @click="onRefresh">
          {{ refreshing ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="banner banner-error" role="alert">{{ error }}</p>
    <p v-if="onboarding.error.value" class="banner" role="status">{{onboarding.error.value}} <NuxtLink to="/docs/getting-started">View guide</NuxtLink></p>
    <p v-if="telemetryError" class="banner banner-error" role="alert">{{ telemetryError }}</p>

    <p v-if="firstPacketNotice" role="status" class="banner">Your first valid packet is stored. <a v-if="rows.length" href="#latest-event" class="underline">Inspect the latest reading below</a><span v-else>Select the reporting device to inspect its stored reading</span>. Webhook delivery is tracked separately.</p>
    <FirstDeviceGuide
      v-if="showSetupGuide"
      :device-id="selectedId"
      :has-device="!!selectedDevice"
      :has-schema="!!selectedId && !!onboarding.state.value?.schema_device_ids?.includes(selectedId)"
      :has-telemetry="!!selectedDevice?.first_telemetry_at || (!!chartRows.length && rowsDeviceId === selectedId)"
      :has-visible-telemetry="!!rows.length"
      :expected-interval-ms="selectedDevice?.expected_report_interval_ms"
      :configured="!!selectedDevice?.configuration_acknowledged_at"
      :downloaded="!!selectedDevice?.starter_downloaded_at"
      @dismiss="dismissGuide"
      :can-write="canWrite"
    />

    <div class="flex flex-wrap gap-3 text-xs"><button v-if="!showSetupGuide" class="btn-ghost text-xs" @click="onboarding.reopened.value=true;onboarding.refresh()">Getting Started</button><NuxtLink to="/docs/getting-started" class="text-[#b79bff]">First-packet guide</NuxtLink></div>
    <p v-if="selectedDevice && !selectedDevice.last_seen && !selectedDevice.first_telemetry_at && !showSetupGuide" class="banner">This device has not reported yet. <NuxtLink :to="`/dashboard/schema?device=${selectedId}`">Set up this device</NuxtLink>. Open Getting Started for the full workflow.</p>
    <template v-if="devices.length">
      <div class="grid min-h-0 items-stretch gap-4 lg:grid-cols-12">
        <section class="card flex min-h-[360px] flex-col p-4 lg:col-span-8">
          <LazyTelemetryChart v-if="chartRows.length"
            :rows="chartRows"
            :loading="telemetryPending"
            :empty-label="telemetryError ? 'Stored events could not be loaded.' : undefined"
          />
          <div v-else class="grid min-h-[300px] place-items-center text-sm text-[#9AA3B2]" role="status">{{telemetryPending?'Loading stored readings…':'No retained readings. Send telemetry or check the device guide.'}}</div>
        </section>

        <dl class="flex flex-col gap-3 lg:col-span-4">
          <div class="card flex-1 px-4 py-3.5">
            <dt class="text-xs text-[#9AA3B2]">Last stored event</dt>
            <dd class="mt-2 text-sm text-[#E8EAEF]">{{ lastStoredLabel }}</dd>
          </div>
          <div class="card flex-1 px-4 py-3.5">
            <dt class="text-xs text-[#9AA3B2]">Recent events</dt>
            <dd class="mt-2 text-lg font-medium tracking-tight text-[#E8EAEF]">{{ telemetryPending ? '…' : rows.length }}</dd>
          </div>
          <div class="card flex-1 px-4 py-3.5">
            <dt class="text-xs text-[#9AA3B2]">Selected device activity</dt>
            <dd class="mt-2 text-sm font-medium tracking-tight text-[#E8EAEF]">
              {{ selectedActivity }}
              <span class="mt-1 block text-xs font-normal tracking-normal text-[#9AA3B2]">{{ ACTIVITY_HELP }}</span>
            </dd>
          </div>
        </dl>
      </div>

      <div v-if="selectedId" class="flex flex-wrap gap-2">
        <NuxtLink class="btn-ghost text-xs" :to="`/dashboard/schema?device=${selectedId}`">Schema</NuxtLink>
        <NuxtLink class="btn-ghost text-xs" :to="`/dashboard/debugger?device=${selectedId}`">Diagnostics</NuxtLink>
      </div>

      <div class="grid min-h-0 gap-4 lg:grid-cols-12">
        <section class="card min-h-[220px] p-4 lg:col-span-4">
          <DeviceList :devices="devices" :selected-id="selectedId" @select="onSelectDevice" />
        </section>

        <section id="latest-event" class="card min-h-0 overflow-auto p-4 lg:col-span-8">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-[#E8EAEF]">Latest stored event</h2>
            <span class="shrink-0 text-xs text-[#9AA3B2]">{{ lastStoredLabel }}</span>
          </div>
          <p v-if="telemetryPending" class="text-sm text-[#9AA3B2]">Loading stored events…</p>
          <p v-else-if="telemetryError" class="text-sm text-[#9AA3B2]">Stored events could not be loaded.</p>
          <p v-else-if="!latest" class="text-sm text-[#9AA3B2]">
            No events received yet.
            <NuxtLink v-if="selectedId" class="underline" :to="`/dashboard/schema?device=${selectedId}`">
              Check this device’s schema
            </NuxtLink>
            <span v-if="selectedId"> and send a packet.</span>
          </p>
          <pre
            v-else
            class="mono whitespace-pre-wrap break-all rounded-xl bg-black p-3 text-xs leading-6 text-[#c5cad3]"
          >{{ latestJson }}</pre>
          <p class="mt-2 text-xs text-[#9AA3B2]">
            Stored JSON is not evidence that your backend received the webhook.
          </p>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

import { deviceActivity, ACTIVITY_HELP } from '#shared/deviceActivity'



const route = useRoute()
const { devices, schemas, error, devicesLoaded, fetchDevices, subscribePresence } = useDevices()
const { rows, connectionStatus, rowsDeviceId, fetchTelemetry, subscribe, clearTelemetry } = useTelemetry()
const { telemetryRetentionDays } = useEntitlements()
const { canWrite } = useOrganization()

function preferredDeviceId() {
  const requested = typeof route.query.device === 'string' ? route.query.device : ''
  if (requested && devices.value.some((device) => device.id === requested)) return requested
  return devices.value[0]?.id ?? null
}

const selectedId = ref<string | null>(preferredDeviceId())
const telemetrySettledId = ref<string | null>(
  selectedId.value && rowsDeviceId.value === selectedId.value ? selectedId.value : null,
)
const refreshing = ref(false)
const telemetryError = ref('')
let unsubPresence: (() => void) | undefined
let unsubTelemetry: (() => void) | undefined

const selectedDevice = computed(() => devices.value.find((d) => d.id === selectedId.value))
const telemetryPending = computed(() => !!selectedId.value && telemetrySettledId.value !== selectedId.value)
const chartRows = computed(() => telemetryPending.value ? [] : rows.value)
const awaitingDevices = computed(() => !error.value && !devicesLoaded.value && !devices.value.length)
const onboarding=useOnboarding()
const firstPacketNotice=ref(false)
watch(()=>onboarding.state.value?.first_packet_at,(value,previous)=>{if(value&&previous===null)firstPacketNotice.value=true})
const showSetupGuide=computed(()=>onboarding.show.value && devicesLoaded.value)
const now=ref(Date.now());let activityTimer:ReturnType<typeof setInterval>|undefined
async function dismissGuide(){try{await onboarding.dismiss()}catch(e:any){telemetryError.value=e.message}}
const deviceHeading = computed(() => {
  if (selectedDevice.value) return selectedDevice.value.name
  return awaitingDevices.value ? 'Loading devices…' : 'No device selected'
})
const latest = computed(() => chartRows.value[chartRows.value.length - 1] || null)
const selectedActivity=computed(()=>deviceActivity(selectedDevice.value||{},now.value))
const latestJson = computed(() =>
  latest.value ? JSON.stringify(latest.value.parsed_json, null, 2) : '',
)
const lastStoredLabel = computed(() => {
  if (telemetryPending.value) return 'Loading…'
  return latest.value?.timestamp ? formatTime(latest.value.timestamp) : 'No stored event in this window'
})

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], { timeZoneName: 'short' })
}

async function onSelectDevice(id: string) {
  const warm = telemetrySettledId.value === id && rowsDeviceId.value === id
  selectedId.value = id
  if (!warm) telemetrySettledId.value = null
  unsubTelemetry?.()
  unsubTelemetry = subscribe(id)
  telemetryError.value = ''
  try {
    await fetchTelemetry(id)
  } catch (e: any) {
    if (selectedId.value === id) telemetryError.value = e.message || 'Unable to load telemetry'
  } finally {
    if (selectedId.value === id && (rowsDeviceId.value === id || telemetryError.value)) {
      telemetrySettledId.value = id
    }
  }
}

watch(()=>rows.value.length,()=>{if(rows.value.length)void onboarding.refresh()})
watch(rowsDeviceId, (deviceId) => {
  if (deviceId && deviceId === selectedId.value) {
    telemetrySettledId.value = deviceId
    telemetryError.value = ''
  }
})

async function onRefresh() {
  refreshing.value = true
  try {
    await Promise.all([fetchDevices({ force: true }),onboarding.refresh()])
    const requested = typeof route.query.device === 'string' ? route.query.device : ''
    const id =
      (selectedId.value && devices.value.some((d) => d.id === selectedId.value) && selectedId.value) ||
      (devices.value.some((d) => d.id === requested) ? requested : '') ||
      devices.value[0]?.id ||
      null
    if (id) {
      if (selectedId.value !== id) await onSelectDevice(id)
      else {
        telemetryError.value = ''
        try {
          await fetchTelemetry(id)
        } catch (e: any) {
          telemetryError.value = e.message || 'Unable to refresh telemetry'
        } finally {
          if (selectedId.value === id) telemetrySettledId.value = id
        }
      }
    } else {
      unsubTelemetry?.()
      unsubTelemetry = undefined
      selectedId.value = null
      telemetrySettledId.value = null
      clearTelemetry()
    }
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  await fetchDevices()
  void onboarding.refresh()
  activityTimer=setInterval(()=>{now.value=Date.now();if(!onboarding.state.value?.first_packet_at&&!onboarding.state.value?.dismissed_at)void onboarding.refresh()},30000)
  unsubPresence = subscribePresence()
  const id = preferredDeviceId()
  if (id) await onSelectDevice(id)
  else {
    selectedId.value = null
    telemetrySettledId.value = null
    clearTelemetry()
  }
})

watch(() => route.query.device, (requested) => {
  if (typeof requested === 'string' && requested !== selectedId.value && devices.value.some((d) => d.id === requested)) {
    void onSelectDevice(requested)
  }
})

onBeforeUnmount(() => {
  clearInterval(activityTimer)
  unsubPresence?.()
  unsubTelemetry?.()
})
</script>

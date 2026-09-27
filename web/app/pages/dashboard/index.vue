<template>
  <div class="flex min-h-0 flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-[#E8EAEF]">
          {{ selectedDevice ? selectedDevice.name : 'No device selected' }}
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
    <p v-if="telemetryError" class="banner banner-error" role="alert">{{ telemetryError }}</p>
    <p v-else-if="loading && !devices.length" class="text-sm text-[#9AA3B2]">Loading devices…</p>

    <FirstDeviceGuide
      v-if="!loading && !error && (!selectedDevice || !selectedSchema?.schema_definition.length || !rows.length)"
      :device-id="selectedId"
      :has-device="!!selectedDevice"
      :has-schema="!!selectedSchema?.schema_definition.length"
      :has-telemetry="!!rows.length"
      :can-write="canWrite"
    />

    <template v-if="devices.length">
      <div class="grid min-h-0 items-stretch gap-4 lg:grid-cols-12">
        <section class="card flex min-h-[360px] flex-col p-4 lg:col-span-8">
          <TelemetryChart :rows="rows" />
        </section>

        <dl class="flex flex-col gap-3 lg:col-span-4">
          <div class="card flex-1 px-4 py-3.5">
            <dt class="text-xs text-[#9AA3B2]">Last stored event</dt>
            <dd class="mt-2 text-sm text-[#E8EAEF]">{{ lastStoredLabel }}</dd>
          </div>
          <div class="card flex-1 px-4 py-3.5">
            <dt class="text-xs text-[#9AA3B2]">Recent events</dt>
            <dd class="mt-2 text-lg font-medium tracking-tight text-[#E8EAEF]">{{ rows.length }}</dd>
          </div>
          <div class="card flex-1 px-4 py-3.5">
            <dt class="text-xs text-[#9AA3B2]">Selected device activity</dt>
            <dd class="mt-2 text-sm font-medium tracking-tight text-[#E8EAEF]">
              {{ selectedDeviceActive ? 'Packet seen within 30 seconds' : 'No packet in the last 30 seconds' }}
              <span class="mt-1 block text-xs font-normal tracking-normal text-[#9AA3B2]">Based on the latest packet, not a connection status.</span>
            </dd>
          </div>
        </dl>
      </div>

      <div v-if="selectedId" class="flex flex-wrap gap-2">
        <NuxtLink class="btn-ghost text-xs" :to="`/dashboard/schema?device=${selectedId}`">Schema</NuxtLink>
        <NuxtLink class="btn-ghost text-xs" :to="`/dashboard/debugger?device=${selectedId}`">Diagnostics</NuxtLink>
        <NuxtLink class="btn-ghost text-xs" to="/dashboard/destinations">Destinations</NuxtLink>
        <NuxtLink class="btn-ghost text-xs" to="/dashboard/deliveries">Deliveries</NuxtLink>
      </div>

      <div class="grid min-h-0 gap-4 lg:grid-cols-12">
        <section class="card min-h-[220px] p-4 lg:col-span-4">
          <DeviceList :devices="devices" :selected-id="selectedId" @select="onSelectDevice" />
        </section>

        <section class="card min-h-0 overflow-auto p-4 lg:col-span-8">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-[#E8EAEF]">Latest stored event</h2>
            <span class="shrink-0 text-xs text-[#9AA3B2]">{{ lastStoredLabel }}</span>
          </div>
          <p v-if="!latest" class="text-sm text-[#9AA3B2]">
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

import { isDeviceOnline } from '~/types'

const route = useRoute()
const { devices, schemas, loading, error, fetchDevices, subscribePresence } = useDevices()
const { rows, connectionStatus, fetchTelemetry, subscribe, clearTelemetry } = useTelemetry()
const { telemetryRetentionDays } = useEntitlements()
const { canWrite } = useOrganization()

const selectedId = ref<string | null>(null)
const refreshing = ref(false)
const telemetryError = ref('')
let unsubPresence: (() => void) | undefined
let unsubTelemetry: (() => void) | undefined

const selectedDevice = computed(() => devices.value.find((d) => d.id === selectedId.value))
const selectedSchema = computed(() => selectedId.value ? schemas.value[selectedId.value] : null)
const latest = computed(() => rows.value[rows.value.length - 1] || null)
const selectedDeviceActive = computed(() =>
  isDeviceOnline(selectedDevice.value?.last_seen || null) || isDeviceOnline(latest.value?.timestamp || null),
)
const latestJson = computed(() =>
  latest.value ? JSON.stringify(latest.value.parsed_json, null, 2) : '',
)
const lastStoredLabel = computed(() =>
  latest.value?.timestamp ? formatTime(latest.value.timestamp) : 'No stored event in this window',
)

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], { timeZoneName: 'short' })
}

async function onSelectDevice(id: string) {
  selectedId.value = id
  unsubTelemetry?.()
  unsubTelemetry = subscribe(id)
  telemetryError.value = ''
  try {
    await fetchTelemetry(id)
  } catch (e: any) {
    if (selectedId.value === id) telemetryError.value = e.message || 'Unable to load telemetry'
  }
}

async function onRefresh() {
  refreshing.value = true
  try {
    await fetchDevices({ force: true })
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
        }
      }
    } else {
      unsubTelemetry?.()
      unsubTelemetry = undefined
      selectedId.value = null
      clearTelemetry()
    }
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  await fetchDevices()
  unsubPresence = subscribePresence()
  const requested = typeof route.query.device === 'string' ? route.query.device : ''
  const id = devices.value.some((d) => d.id === requested) ? requested : devices.value[0]?.id
  if (id) await onSelectDevice(id)
  else clearTelemetry()
})

watch(() => route.query.device, (requested) => {
  if (typeof requested === 'string' && requested !== selectedId.value && devices.value.some((d) => d.id === requested)) {
    void onSelectDevice(requested)
  }
})

onBeforeUnmount(() => {
  unsubPresence?.()
  unsubTelemetry?.()
})
</script>

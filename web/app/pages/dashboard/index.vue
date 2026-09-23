<template>
  <div class="flex min-h-0 flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-[#C5CAD3]">
          {{ selectedDevice ? selectedDevice.name : 'No device selected' }}
        </p>
        <p class="mt-1 text-xs text-[#9AA3B2]">
          Recent events are the latest stored samples for this device, up to 50, inside the
          {{ telemetryRetentionDays }}-day retention window. This is not a lifetime total.
        </p>
      </div>
      <button type="button" class="btn-ghost shrink-0 text-xs" :disabled="refreshing" @click="onRefresh">
        {{ refreshing ? 'Refreshing…' : 'Refresh' }}
      </button>
    </div>

    <p v-if="error" class="banner banner-error" role="alert">{{ error }}</p>
    <p v-else-if="loading && !devices.length" class="text-sm text-[#9AA3B2]">Loading devices…</p>

    <div v-if="!loading && !devices.length" class="card p-6">
      <h2 class="text-sm font-semibold">No devices yet</h2>
      <p class="mt-1 text-sm text-[#9AA3B2]">Create a device, then send an authenticated event.</p>
      <NuxtLink to="/dashboard/devices" class="btn-primary mt-3 text-xs">Add device</NuxtLink>
    </div>

    <template v-else>
      <dl class="grid gap-3 sm:grid-cols-3">
        <div class="card px-3 py-2.5">
          <dt class="text-xs text-[#9AA3B2]">Last stored event</dt>
          <dd class="mt-1 text-sm text-[#E8EAEF]">{{ lastStoredLabel }}</dd>
        </div>
        <div class="card px-3 py-2.5">
          <dt class="text-xs text-[#9AA3B2]">Recent events</dt>
          <dd class="mt-1 text-sm text-[#E8EAEF]">{{ rows.length }}</dd>
        </div>
        <div class="card px-3 py-2.5">
          <dt class="text-xs text-[#9AA3B2]">Seen in the last 30 seconds</dt>
          <dd class="mt-1 text-sm text-[#E8EAEF]">
            {{ recentCount }}
            <span class="block text-xs font-normal text-[#9AA3B2]">Not a connection status.</span>
          </dd>
        </div>
      </dl>

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

        <section class="card flex min-h-[260px] flex-col p-4 lg:col-span-8">
          <TelemetryChart :rows="rows" />
        </section>

        <section class="card min-h-0 overflow-auto p-4 lg:col-span-12">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-[#E8EAEF]">Latest stored event</h2>
            <span class="shrink-0 text-xs text-[#9AA3B2]">{{ lastStoredLabel }}</span>
          </div>
          <p v-if="!latest" class="text-sm text-[#9AA3B2]">
            No events received yet.
            <NuxtLink v-if="selectedId" class="underline" :to="`/dashboard/schema?device=${selectedId}`">
              Check this device’s schema
            </NuxtLink>
            and send a packet.
          </p>
          <pre
            v-else
            class="mono whitespace-pre-wrap break-all rounded-lg bg-[#0c0d10] p-3 text-xs leading-6 text-[#c5cad3]"
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
const { devices, loading, error, fetchDevices, subscribePresence } = useDevices()
const { rows, fetchTelemetry, subscribe } = useTelemetry()
const { telemetryRetentionDays } = useEntitlements()

const selectedId = ref<string | null>(null)
const refreshing = ref(false)
let unsubPresence: (() => void) | undefined
let unsubTelemetry: (() => void) | undefined

const selectedDevice = computed(() => devices.value.find((d) => d.id === selectedId.value))
const recentCount = computed(
  () => devices.value.filter((d) => isDeviceOnline(d.last_seen)).length,
)
const latest = computed(() => rows.value[rows.value.length - 1] || null)
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
  await fetchTelemetry(id)
  unsubTelemetry = subscribe(id)
}

async function onRefresh() {
  refreshing.value = true
  try {
    await fetchDevices()
    const requested = typeof route.query.device === 'string' ? route.query.device : ''
    const id =
      (selectedId.value && devices.value.some((d) => d.id === selectedId.value) && selectedId.value) ||
      (devices.value.some((d) => d.id === requested) ? requested : '') ||
      devices.value[0]?.id ||
      null
    if (id) {
      if (selectedId.value !== id) await onSelectDevice(id)
      else await fetchTelemetry(id)
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
})

onBeforeUnmount(() => {
  unsubPresence?.()
  unsubTelemetry?.()
})
</script>

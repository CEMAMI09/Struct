<template>
  <div class="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col gap-4">
    <!-- Bento grid: no endless scroll -->
    <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-12 lg:grid-rows-2">
      <!-- Devices column -->
      <section class="card min-h-0 p-4 lg:col-span-4 lg:row-span-2">
        <DeviceList
          :devices="devices"
          :selected-id="selectedId"
          @select="onSelectDevice"
        />
      </section>

      <!-- Chart -->
      <section class="card min-h-0 p-4 lg:col-span-8 lg:row-span-1">
        <TelemetryChart :rows="rows" :live="live" />
      </section>

      <!-- Latest packet + stats -->
      <section class="card min-h-0 overflow-auto p-4 lg:col-span-5 lg:row-span-1">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-[#E8EAEF]">Latest packet</h2>
          <span class="font-mono text-[10px] text-[#8B93A7]">
            {{ latest?.timestamp ? formatTime(latest.timestamp) : '—' }}
          </span>
        </div>
        <pre
          class="mono whitespace-pre-wrap break-all rounded-lg bg-[#0F1115] p-3 text-xs leading-6 text-[#00FFA3]"
        >{{ latestJson }}</pre>
      </section>

      <section class="card grid grid-cols-2 gap-4 p-4 lg:col-span-3 lg:row-span-1">
        <div>
          <p class="text-[10px] uppercase tracking-wider text-[#8B93A7]">Online</p>
          <p class="mt-1 text-2xl font-semibold text-[#00FFA3]">{{ onlineCount }}</p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wider text-[#8B93A7]">Packets</p>
          <p class="mt-1 text-2xl font-semibold text-[#E8EAEF]">{{ rows.length }}</p>
        </div>
        <div class="col-span-2 border-t border-[#2A2F3A] pt-3">
          <p class="text-[10px] uppercase tracking-wider text-[#8B93A7]">Selected</p>
          <p class="mt-1 truncate text-sm text-[#E8EAEF]">
            {{ selectedDevice?.name || 'None' }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isDeviceOnline } from '~/types'

const { devices, fetchDevices, subscribePresence } = useDevices()
const { rows, live, fetchTelemetry, subscribe } = useTelemetry()

const selectedId = ref<string | null>(null)
let unsubPresence: (() => void) | undefined
let unsubTelemetry: (() => void) | undefined

const selectedDevice = computed(() => devices.value.find((d) => d.id === selectedId.value))
const onlineCount = computed(
  () => devices.value.filter((d) => isDeviceOnline(d.last_seen)).length,
)
const latest = computed(() => rows.value[rows.value.length - 1] || null)
const latestJson = computed(() =>
  latest.value
    ? JSON.stringify(latest.value.parsed_json, null, 2)
    : '{\n  // no telemetry yet\n}',
)

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString()
}

async function onSelectDevice(id: string) {
  selectedId.value = id
  unsubTelemetry?.()
  await fetchTelemetry(id)
  unsubTelemetry = subscribe(id)
}

onMounted(async () => {
  await fetchDevices()
  unsubPresence = subscribePresence()
  if (devices.value[0]) {
    await onSelectDevice(devices.value[0].id)
  }
})

onBeforeUnmount(() => {
  unsubPresence?.()
  unsubTelemetry?.()
})
</script>

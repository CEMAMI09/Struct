<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="mb-3 flex shrink-0 items-center justify-between">
      <h2 class="text-sm font-semibold text-[#E8EAEF]">Devices</h2>
      <span class="text-xs text-[#8B93A7]"
        >{{ devices.length }}
        {{ fleetMode ? 'in this view' : 'registered' }}</span
      >
    </div>

    <div
      v-if="!devices.length"
      class="flex flex-1 flex-col items-center justify-center text-center"
    >
      <p class="text-sm text-[#9AA3B2]">No devices yet</p>
      <NuxtLink to="/dashboard/devices" class="btn-primary mt-3 text-xs"
        >Add device</NuxtLink
      >
    </div>

    <p v-if="fleetMode" class="mb-2 text-xs text-[#9AA3B2]">
      Recent devices and the selected device.
      <NuxtLink to="/dashboard/devices" class="underline"
        >Search the full fleet</NuxtLink
      >.
    </p>
    <ul
      v-if="devices.length"
      class="min-h-0 flex-1 space-y-1.5 overflow-y-auto"
    >
      <li v-for="device in devices" :key="device.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition"
          :class="
            selectedId === device.id
              ? 'device-row--selected'
              : 'device-row--idle'
          "
          :aria-current="selectedId === device.id ? 'true' : undefined"
          @click="$emit('select', device.id)"
        >
          <StatusDot :status="deviceActivity(device, now)" show-label />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-[#E8EAEF]">{{
              device.name
            }}</span>
            <span class="mono block truncate text-[10px] text-[#9AA3B2]">{{
              device.secure_v2_enabled
                ? 'Wire ID ' + device.wire_device_id
                : 'Existing device ' + device.id
            }}</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { Device } from '~/types'
import { deviceActivity } from '#shared/deviceActivity'
const fleetMode = String(useRuntimeConfig().public.fleetEnabled) === 'true'
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 15000)
})
onBeforeUnmount(() => clearInterval(timer))

defineProps<{
  devices: Device[]
  selectedId?: string | null
}>()

defineEmits<{ select: [id: string] }>()
</script>

<style scoped>
.device-row--idle:hover {
  background: var(--struct-hover);
}

.device-row--selected {
  background: var(--struct-selected);
}
</style>

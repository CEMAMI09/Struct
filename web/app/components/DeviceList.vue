<template>
  <div class="flex h-full flex-col">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-[#E8EAEF]">Devices</h2>
      <span class="font-mono text-[10px] text-[#8B93A7]">{{ devices.length }} registered</span>
    </div>

    <div v-if="!devices.length" class="flex flex-1 flex-col items-center justify-center text-center">
      <p class="text-sm text-[#8B93A7]">No devices yet</p>
      <NuxtLink to="/dashboard/devices" class="btn-primary mt-3 text-xs">Add device</NuxtLink>
    </div>

    <ul v-else class="flex-1 space-y-1 overflow-auto">
      <li
        v-for="device in devices"
        :key="device.id"
        class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition"
        :class="
          selectedId === device.id
            ? 'bg-[#00FFA3]/10 ring-1 ring-[#00FFA3]/30'
            : 'hover:bg-[#0F1115]/80'
        "
        @click="$emit('select', device.id)"
      >
        <StatusDot :online="isDeviceOnline(device.last_seen)" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-[#E8EAEF]">{{ device.name }}</p>
          <p class="mono truncate text-[10px] text-[#8B93A7]">{{ device.api_key }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { Device } from '~/types'
import { isDeviceOnline } from '~/types'

defineProps<{
  devices: Device[]
  selectedId?: string | null
}>()

defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-[#E8EAEF]">Your devices</h2>
        <p class="text-sm text-[#8B93A7]">
          Each device gets a 16-byte API key prepended to every TCP frame.
        </p>
      </div>
      <button class="btn-primary" @click="showForm = !showForm">
        {{ showForm ? 'Cancel' : 'Add device' }}
      </button>
    </div>

    <form v-if="showForm" class="card mb-6 flex gap-3 p-4" @submit.prevent="onCreate">
      <input
        v-model="newName"
        class="input flex-1"
        placeholder="Device name (e.g. ESP32 Kitchen)"
        required
      />
      <button type="submit" class="btn-primary" :disabled="creating">
        {{ creating ? 'Creating…' : 'Create' }}
      </button>
    </form>

    <p v-if="error" class="mb-4 text-sm text-red-400">{{ error }}</p>

    <div class="card divide-y divide-[#2A2F3A] overflow-hidden">
      <div
        v-if="!devices.length"
        class="p-8 text-center text-sm text-[#8B93A7]"
      >
        No devices yet. Create one to get an API key.
      </div>

      <div
        v-for="device in devices"
        :key="device.id"
        class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-start gap-3">
          <StatusDot :online="isDeviceOnline(device.last_seen)" class="mt-1.5" />
          <div>
            <p class="font-medium text-[#E8EAEF]">{{ device.name }}</p>
            <p class="mt-1 font-mono text-xs text-[#00FFA3]">{{ device.api_key }}</p>
            <p class="mt-1 text-[10px] text-[#8B93A7]">
              Last seen:
              {{ device.last_seen ? new Date(device.last_seen).toLocaleString() : 'never' }}
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <button class="btn-ghost text-xs" @click="copyKey(device.api_key)">
            {{ copied === device.api_key ? 'Copied' : 'Copy key' }}
          </button>
          <button class="btn-ghost text-xs text-red-400 hover:border-red-400/40" @click="onDelete(device.id)">
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isDeviceOnline } from '~/types'

const { devices, error, fetchDevices, createDevice, deleteDevice } = useDevices()

const showForm = ref(false)
const newName = ref('')
const creating = ref(false)
const copied = ref('')

onMounted(fetchDevices)

async function onCreate() {
  creating.value = true
  try {
    await createDevice(newName.value.trim())
    newName.value = ''
    showForm.value = false
  } catch (e: any) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}

async function onDelete(id: string) {
  if (!confirm('Delete this device and its telemetry?')) return
  try {
    await deleteDevice(id)
  } catch (e: any) {
    error.value = e.message
  }
}

async function copyKey(key: string) {
  await navigator.clipboard.writeText(key)
  copied.value = key
  setTimeout(() => {
    if (copied.value === key) copied.value = ''
  }, 1500)
}
</script>

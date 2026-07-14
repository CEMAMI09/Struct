<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6 flex items-center justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold text-[#E8EAEF]">Destinations</h2>
        <p class="text-sm text-[#8B93A7]">
          Pipe every parsed packet to your own systems. Struct is a router — not your data warehouse.
        </p>
      </div>
      <button class="btn-primary shrink-0" @click="showForm = !showForm">
        {{ showForm ? 'Cancel' : 'Add Destination' }}
      </button>
    </div>

    <form v-if="showForm" class="card mb-6 space-y-4 p-4" @submit.prevent="onCreate">
      <div>
        <label class="label">Name</label>
        <input v-model="form.name" class="input" placeholder="AWS API / Plant webhook" required />
      </div>
      <div>
        <label class="label">Webhook URL</label>
        <input
          v-model="form.url"
          class="input mono"
          type="url"
          placeholder="https://hooks.example.com/struct"
          required
        />
      </div>
      <div>
        <label class="label">Scope</label>
        <select v-model="form.device_id" class="input">
          <option value="">All devices</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <button type="submit" class="btn-primary" :disabled="creating">
        {{ creating ? 'Saving…' : 'Create destination' }}
      </button>
    </form>

    <p v-if="error" class="mb-4 text-sm text-red-400">{{ error }}</p>

    <div class="card divide-y divide-[#2A2F3A] overflow-hidden">
      <div v-if="!destinations.length" class="p-8 text-center text-sm text-[#8B93A7]">
        No destinations yet. Add a URL and every parsed JSON packet will POST there instantly.
      </div>

      <div
        v-for="dest in destinations"
        :key="dest.id"
        class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span
              class="h-2 w-2 rounded-full"
              :class="dest.enabled ? 'bg-[#00FFA3]' : 'bg-[#8B93A7]'"
            />
            <p class="font-medium text-[#E8EAEF]">{{ dest.name }}</p>
          </div>
          <p class="mt-1 truncate font-mono text-xs text-[#8B93A7]">{{ dest.url }}</p>
          <p class="mt-1 text-[10px] text-[#8B93A7]">
            {{ dest.device_id ? deviceName(dest.device_id) : 'All devices' }}
          </p>
        </div>
        <div class="flex shrink-0 gap-2">
          <button class="btn-ghost text-xs" @click="onToggle(dest)">
            {{ dest.enabled ? 'Disable' : 'Enable' }}
          </button>
          <button
            class="btn-ghost text-xs text-red-400 hover:border-red-400/40"
            @click="onDelete(dest.id)"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <div class="card mt-6 p-4">
      <p class="label">Webhook body</p>
      <pre class="mono overflow-x-auto rounded-lg bg-[#0F1115] p-3 text-xs leading-relaxed text-[#00FFA3]">{{ webhookExample }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
const { devices, fetchDevices } = useDevices()
const {
  destinations,
  error,
  fetchDestinations,
  createDestination,
  toggleDestination,
  deleteDestination,
} = useDestinations()

const showForm = ref(false)
const creating = ref(false)
const form = reactive({
  name: '',
  url: '',
  device_id: '',
})

const webhookExample = `{
  "device_id": "…",
  "device_name": "ESP32 Chicago",
  "timestamp": "2026-07-14T18:00:00.000Z",
  "payload": { "temp": 72.5, "humidity": 45.2 }
}`

onMounted(async () => {
  await Promise.all([fetchDevices(), fetchDestinations()])
})

function deviceName(id: string) {
  return devices.value.find((d) => d.id === id)?.name || id.slice(0, 8)
}

async function onCreate() {
  creating.value = true
  try {
    await createDestination({
      name: form.name.trim(),
      url: form.url.trim(),
      device_id: form.device_id || null,
    })
    form.name = ''
    form.url = ''
    form.device_id = ''
    showForm.value = false
  } catch (e: any) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}

async function onToggle(dest: { id: string; enabled: boolean }) {
  try {
    await toggleDestination(dest.id, !dest.enabled)
  } catch (e: any) {
    error.value = e.message
  }
}

async function onDelete(id: string) {
  if (!confirm('Remove this destination?')) return
  try {
    await deleteDestination(id)
  } catch (e: any) {
    error.value = e.message
  }
}
</script>

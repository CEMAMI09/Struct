<template>
  <div class="mx-auto max-w-4xl">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold text-[#E8EAEF]">Fleet</h2>
        <p class="text-sm text-[#8B93A7]">
          Tag devices like industrial assets. Filter 400 sensors down to the 12 that matter.
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

    <!-- Search / filter -->
    <div class="mb-4 flex flex-wrap gap-3">
      <input
        v-model="query"
        class="input max-w-md flex-1 mono"
        placeholder="Filter: Chicago_Factory, offline, v1.0.4…"
      />
      <label class="flex cursor-pointer items-center gap-2 text-xs text-[#8B93A7]">
        <input v-model="offlineOnly" type="checkbox" class="accent-[#38B6FF]" />
        Offline in last hour
      </label>
      <span class="self-center font-mono text-[10px] text-[#8B93A7]">
        {{ filtered.length }} / {{ devices.length }}
      </span>
    </div>

    <p v-if="error" class="mb-4 text-sm text-red-400">{{ error }}</p>

    <div v-if="!filtered.length" class="card p-8 text-center text-sm text-[#8B93A7]">
      {{ devices.length ? 'No devices match this filter.' : 'No devices yet. Create one to get an API key.' }}
    </div>

    <div v-else class="space-y-3 p-0.5">
      <div
        v-for="device in filtered"
        :key="device.id"
        class="device-card rounded-xl bg-[#1A1D24] p-4"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="flex items-start gap-3">
            <StatusDot :online="isDeviceOnline(device.last_seen)" class="mt-1.5" />
            <div>
              <p class="font-medium text-[#E8EAEF]">{{ device.name }}</p>
              <p class="mt-1 font-mono text-xs text-[#38B6FF]">{{ device.api_key }}</p>
              <p class="mt-1 text-[10px] text-[#8B93A7]">
                Last seen:
                {{ device.last_seen ? new Date(device.last_seen).toLocaleString() : 'never' }}
                <span v-if="device.encryption_enabled" class="ml-2 text-[#38B6FF]">· ChaCha20</span>
              </p>
              <div v-if="Object.keys(device.tags || {}).length" class="mt-2 flex flex-wrap gap-1.5">
                <span
                  v-for="(val, key) in device.tags"
                  :key="String(key)"
                  class="rounded border border-[#2A2F3A] bg-[#0F1115] px-2 py-0.5 font-mono text-[10px] text-[#8B93A7]"
                >
                  <span class="text-[#E8EAEF]">{{ key }}</span>:{{ val }}
                </span>
              </div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn-ghost text-xs" @click="copyKey(device.api_key)">
              {{ copied === device.api_key ? 'Copied' : 'Copy key' }}
            </button>
            <button class="btn-ghost text-xs" @click="toggleEdit(device.id)">
              {{ editingId === device.id ? 'Close' : 'Tags / Command' }}
            </button>
            <button
              class="btn-ghost text-xs text-red-400 hover:border-red-400/40"
              @click="onDelete(device.id)"
            >
              Delete
            </button>
          </div>
        </div>

        <!-- Expand: tags + downlink -->
        <div v-if="editingId === device.id" class="mt-4 grid gap-4 border-t border-[#2A2F3A] pt-4 lg:grid-cols-2">
          <div>
            <p class="label">Tags</p>
            <div class="space-y-2">
              <div
                v-for="(pair, idx) in tagDraft"
                :key="idx"
                class="grid grid-cols-[1fr_1fr_32px] gap-2"
              >
                <input v-model="pair.key" class="input text-xs" placeholder="Location" />
                <input v-model="pair.value" class="input text-xs" placeholder="Chicago_Factory" />
                <button type="button" class="btn-ghost px-0 text-[#8B93A7]" @click="tagDraft.splice(idx, 1)">
                  ×
                </button>
              </div>
              <button type="button" class="btn-ghost w-full border-dashed text-xs" @click="tagDraft.push({ key: '', value: '' })">
                + Tag
              </button>
              <button type="button" class="btn-primary w-full text-xs" :disabled="savingTags" @click="saveTags(device.id)">
                {{ savingTags ? 'Saving…' : 'Save tags' }}
              </button>
            </div>
          </div>

          <div>
            <p class="label">Send Command (downlink)</p>
            <select v-model="cmdType" class="input mb-2 text-xs">
              <option value="set_interval">set_interval — wake period (sec)</option>
              <option value="reboot">reboot</option>
              <option value="custom">custom hex</option>
            </select>
            <input
              v-if="cmdType === 'set_interval'"
              v-model.number="cmdInterval"
              class="input mb-2 mono text-xs"
              type="number"
              min="1"
              placeholder="600"
            />
            <input
              v-if="cmdType === 'custom'"
              v-model="cmdHex"
              class="input mb-2 mono text-xs"
              placeholder="deadbeef"
            />
            <button
              type="button"
              class="btn-primary w-full text-xs"
              :disabled="sendingCmd"
              @click="onSendCommand(device.id)"
            >
              {{ sendingCmd ? 'Queuing…' : 'Queue downlink' }}
            </button>
            <p class="mt-2 text-[10px] leading-relaxed text-[#8B93A7]">
              Packed binary is delivered on the device’s next TCP session (or immediately if the
              socket is still open).
            </p>
            <p v-if="cmdMsg" class="mt-2 text-xs" :class="cmdErr ? 'text-red-400' : 'text-[#38B6FF]'">
              {{ cmdMsg }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isDeviceOnline, pairsToTags, tagsToPairs } from '~/types'
import type { Device } from '~/types'

const { devices, error, fetchDevices, createDevice, deleteDevice, updateDeviceTags } = useDevices()
const { sendCommand } = useDownlinks()

const showForm = ref(false)
const newName = ref('')
const creating = ref(false)
const copied = ref('')
const query = ref('')
const offlineOnly = ref(false)
const editingId = ref<string | null>(null)
const tagDraft = ref<{ key: string; value: string }[]>([])
const savingTags = ref(false)

const cmdType = ref('set_interval')
const cmdInterval = ref(600)
const cmdHex = ref('')
const sendingCmd = ref(false)
const cmdMsg = ref('')
const cmdErr = ref(false)

const HOUR_MS = 60 * 60 * 1000

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return devices.value.filter((d) => {
    if (offlineOnly.value) {
      if (!d.last_seen) return true
      const age = Date.now() - new Date(d.last_seen).getTime()
      // offline in last hour = was seen sometime, but not online now, and last activity within ~reasonable fleet window
      // Spec: "went offline in the last hour" → last_seen within past hour AND currently offline
      if (isDeviceOnline(d.last_seen)) return false
      if (age > HOUR_MS) return false
    }

    if (!q) return true

    const hay = [
      d.name,
      d.api_key,
      ...Object.entries(d.tags || {}).flatMap(([k, v]) => [k, v, `${k}:${v}`]),
    ]
      .join(' ')
      .toLowerCase()

    return hay.includes(q)
  })
})

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
    if (editingId.value === id) editingId.value = null
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

function toggleEdit(id: string) {
  if (editingId.value === id) {
    editingId.value = null
    return
  }
  const device = devices.value.find((d) => d.id === id) as Device | undefined
  editingId.value = id
  tagDraft.value = tagsToPairs(device?.tags)
  if (!tagDraft.value.length) {
    tagDraft.value = [
      { key: 'Location', value: '' },
      { key: 'Version', value: '' },
      { key: 'Status', value: 'Deployed' },
    ]
  }
  cmdMsg.value = ''
}

async function saveTags(id: string) {
  savingTags.value = true
  try {
    await updateDeviceTags(id, pairsToTags(tagDraft.value))
  } catch (e: any) {
    error.value = e.message
  } finally {
    savingTags.value = false
  }
}

async function onSendCommand(deviceId: string) {
  sendingCmd.value = true
  cmdMsg.value = ''
  cmdErr.value = false
  try {
    const payload =
      cmdType.value === 'set_interval'
        ? { interval_sec: cmdInterval.value }
        : cmdType.value === 'reboot'
          ? {}
          : { hex: cmdHex.value }

    const row = await sendCommand(deviceId, cmdType.value, payload)
    cmdMsg.value = `Queued ${row.command_type} (${row.packed_hex.length / 2} bytes).`
  } catch (e: any) {
    cmdErr.value = true
    cmdMsg.value = e.message || 'Failed to queue command'
  } finally {
    sendingCmd.value = false
  }
}
</script>

<style scoped>
/* Inset stroke avoids parent overflow-auto clipping outer borders */
.device-card {
  box-shadow: inset 0 0 0 1px #2a2f3a;
}
</style>

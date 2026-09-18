<template>
  <div class="flex min-h-0 flex-col gap-4 lg:h-full">
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-0 w-full flex-1 sm:min-w-[180px]">
        <label class="label">Device</label>
        <select v-model="selectedDeviceId" class="input">
          <option disabled value="">Select device</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <div class="min-w-0 w-full flex-1 sm:min-w-[180px]">
        <label class="label">API secret (64 hex)</label>
        <input v-model="apiSecret" type="password" autocomplete="off" class="input font-mono text-xs" placeholder="From device create/rotate" />
      </div>
      <button class="btn-primary w-full sm:w-auto" :disabled="!canSimulate" @click="simulate">
        {{ simulating ? 'Generating…' : 'Simulate packet' }}
      </button>
    </div>

    <p v-if="selectedDevice?.encryption_enabled" class="text-sm text-amber-300">This device requires encrypted frames. The browser debugger currently previews plaintext only; use the Node or C SDK to test encryption.</p>
    <p class="text-sm text-[#8B93A7]">Local packet preview only. No data is sent; this does not verify credentials against the server, delivery, storage, or webhooks.</p>
    <p v-if="simulationError" role="alert" class="text-sm text-red-400">{{ simulationError }}</p>
    <div
      v-if="!schema.length"
      class="card flex min-h-[200px] flex-1 items-center justify-center p-6 text-sm text-[#8B93A7] sm:p-8"
    >
      {{
        selectedDeviceId
          ? 'This device has an empty schema. Define fields first.'
          : 'Pick a device to simulate its wire format.'
      }}
    </div>

    <div v-else class="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
      <div class="card flex min-h-[220px] flex-col overflow-hidden lg:min-h-0">
        <div class="flex items-center justify-between gap-2 border-b border-[#2A2F3A] px-4 py-3">
          <h3 class="text-sm font-semibold text-[#E8EAEF]">Raw hex</h3>
          <span class="shrink-0 font-mono text-[10px] text-[#8B93A7]">{{ totalBytes }} B frame</span>
        </div>
        <div class="flex-1 overflow-auto p-4">
          <p class="mb-2 text-xs text-[#8B93A7]">
            Protocol v2: header + timestamp + nonce + payload + HMAC
          </p>
          <pre class="mono whitespace-pre-wrap break-all text-xs leading-6 text-[#c5cad3]">{{ hexOutput || '— click Simulate —' }}</pre>
        </div>
      </div>

      <div class="card flex min-h-[220px] flex-col overflow-hidden lg:min-h-0">
        <div class="flex items-center justify-between gap-2 border-b border-[#2A2F3A] px-4 py-3">
          <h3 class="text-sm font-semibold text-[#E8EAEF]">Parsed JSON</h3>
          <span class="shrink-0 font-mono text-[10px] text-[#8B93A7]">LE · packed</span>
        </div>
        <div class="flex-1 overflow-auto p-4">
          <pre class="mono overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 text-[#E8EAEF]">{{ jsonOutput || '—' }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Device, DeviceSchema, SchemaField } from '~/types'

const props = defineProps<{
  devices: Device[]
  schemas: Record<string, DeviceSchema>
}>()

const { encodePayload, parsePayload, toHex, buildV2TelemetryFrame, schemaByteLength } = useBinaryParser()

const selectedDeviceId = ref('')
const apiSecret = ref('')
const hexOutput = ref('')
const jsonOutput = ref('')
const simulating = ref(false)
let simulationGeneration = 0

const selectedDevice = computed(() => props.devices.find((d) => d.id === selectedDeviceId.value))

const schemaRow = computed(() => props.schemas[selectedDeviceId.value])
const simulationError = ref('')
const schema = computed(() => schemaRow.value?.schema_definition || ([] as SchemaField[]))
const schemaVersion = computed(() => schemaRow.value?.version || 1)

const canSimulate = computed(
  () => !simulating.value && !!selectedDevice.value && schema.value.length > 0 && !selectedDevice.value?.encryption_enabled && /^[0-9a-fA-F]{64}$/.test(apiSecret.value),
)

const totalBytes = computed(() => {
  if (!schema.value.length) return 0
  try {
    return 1 + 16 + 1 + 4 + 12 + schemaByteLength(schema.value) + 32
  } catch {
    return 0
  }
})

function randomValues(fields: SchemaField[]): Record<string, string | number | boolean | Record<string, boolean>> {
  const out: Record<string, string | number | boolean | Record<string, boolean>> = {}
  for (const f of fields) {
    switch (f.type) {
      case 'char':
        out[f.name] = '41'.repeat(f.length)
        break
      case 'float32':
        out[f.name] = Math.round((15 + Math.random() * 20) * 100) / 100
        break
      case 'int32':
        out[f.name] = Math.floor(Math.random() * 1000)
        break
      case 'uint8':
        out[f.name] = Math.floor(Math.random() * 256)
        break
      case 'boolean':
        out[f.name] = Math.random() > 0.5
        break
      case 'flags': {
        const flags: Record<string, boolean> = {}
        for (const bit of f.bits || []) {
          flags[bit.name] = Math.random() > 0.5
        }
        out[f.name] = flags
        break
      }
    }
  }
  return out
}

async function simulate() {
  if (!canSimulate.value || !selectedDevice.value) return
  simulationError.value = ''
  const generation = ++simulationGeneration
  simulating.value = true
  const device = { ...selectedDevice.value }
  const fields = structuredClone(toRaw(schema.value))
  const version = schemaVersion.value
  const secret = apiSecret.value
  try {

  const values = randomValues(fields)
  const payload = encodePayload(values, fields)
  const { frame, timestampSec, nonce } = await buildV2TelemetryFrame({
    keyId: device.key_id || device.api_key,
    schemaVersion: version,
    payload,
    secret,
  })

  if (generation !== simulationGeneration) return
  hexOutput.value = toHex(frame)

  const parsed = parsePayload(payload, fields)
  jsonOutput.value = JSON.stringify(
    {
      protocol: 2,
      key_id: device.key_id || device.api_key,
      device: device.name,
      schema_version: version,
      timestamp: timestampSec,
      nonce_hex: toHex(nonce, false),
      payload: parsed,
    },
    null,
    2,
  )
  } catch (e: any) {
    if (generation === simulationGeneration) simulationError.value = e.message || 'Simulation failed'
  } finally {
    if (generation === simulationGeneration) simulating.value = false
  }
}

watch(selectedDeviceId, () => {
  apiSecret.value = ''
}, { flush: 'sync' })

watch([selectedDevice, schemaRow, apiSecret], () => {
  simulationGeneration++
  simulating.value = false
  simulationError.value = ''
  hexOutput.value = ''
  jsonOutput.value = ''
}, { deep: true, flush: 'sync' })
</script>

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
        <input v-model="apiSecret" class="input font-mono text-xs" placeholder="From device create/rotate" />
      </div>
      <button class="btn-primary w-full sm:w-auto" :disabled="!canSimulate" @click="simulate">
        Simulate packet
      </button>
    </div>

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
          <p class="mb-2 text-[10px] uppercase tracking-wider text-[#8B93A7]">
            Protocol v2: header + timestamp + nonce + payload + HMAC
          </p>
          <pre class="mono whitespace-pre-wrap break-all text-xs leading-6 text-[#38B6FF]">{{ hexOutput || '— click Simulate —' }}</pre>
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

const selectedDevice = computed(() => props.devices.find((d) => d.id === selectedDeviceId.value))

const schemaRow = computed(() => props.schemas[selectedDeviceId.value])
const schema = computed(() => schemaRow.value?.schema_definition || ([] as SchemaField[]))
const schemaVersion = computed(() => schemaRow.value?.version || 1)

const canSimulate = computed(
  () => !!selectedDevice.value && schema.value.length > 0 && apiSecret.value.length >= 32,
)

const totalBytes = computed(() => {
  if (!schema.value.length) return 0
  try {
    return 1 + 16 + 1 + 4 + 12 + schemaByteLength(schema.value) + 32
  } catch {
    return 0
  }
})

function randomValues(fields: SchemaField[]): Record<string, number | boolean | Record<string, boolean>> {
  const out: Record<string, number | boolean | Record<string, boolean>> = {}
  for (const f of fields) {
    switch (f.type) {
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
  if (!selectedDevice.value || !schema.value.length || !apiSecret.value) return

  const values = randomValues(schema.value)
  const payload = encodePayload(values, schema.value)
  const { frame, timestampSec, nonce } = await buildV2TelemetryFrame({
    keyId: selectedDevice.value.key_id || selectedDevice.value.api_key,
    schemaVersion: schemaVersion.value,
    payload,
    secret: apiSecret.value,
  })

  hexOutput.value = toHex(frame)

  const parsed = parsePayload(payload, schema.value)
  jsonOutput.value = JSON.stringify(
    {
      protocol: 2,
      key_id: selectedDevice.value.key_id,
      device: selectedDevice.value.name,
      schema_version: schemaVersion.value,
      timestamp: timestampSec,
      nonce_hex: toHex(nonce, false),
      payload: parsed,
    },
    null,
    2,
  )
}

watch(selectedDeviceId, () => {
  hexOutput.value = ''
  jsonOutput.value = ''
})
</script>

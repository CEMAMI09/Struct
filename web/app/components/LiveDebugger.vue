<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-[180px] flex-1">
        <label class="label">Device</label>
        <select v-model="selectedDeviceId" class="input">
          <option disabled value="">Select device</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <button class="btn-primary" :disabled="!canSimulate" @click="simulate">
        Simulate packet
      </button>
    </div>

    <div
      v-if="!schema.length"
      class="card flex flex-1 items-center justify-center p-8 text-sm text-[#8B93A7]"
    >
      {{
        selectedDeviceId
          ? 'This device has an empty schema. Define fields first.'
          : 'Pick a device to simulate its wire format.'
      }}
    </div>

    <div v-else class="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
      <div class="card flex min-h-0 flex-col overflow-hidden">
        <div class="flex items-center justify-between border-b border-[#2A2F3A] px-4 py-3">
          <h3 class="text-sm font-semibold text-[#E8EAEF]">Raw hex</h3>
          <span class="font-mono text-[10px] text-[#8B93A7]">{{ totalBytes }} B frame</span>
        </div>
        <div class="flex-1 overflow-auto p-4">
          <p class="mb-2 text-[10px] uppercase tracking-wider text-[#8B93A7]">
            API key (16 B) + payload
          </p>
          <pre class="mono whitespace-pre-wrap break-all text-xs leading-6 text-[#38B6FF]">{{ hexOutput || '— click Simulate —' }}</pre>
        </div>
      </div>

      <div class="card flex min-h-0 flex-col overflow-hidden">
        <div class="flex items-center justify-between border-b border-[#2A2F3A] px-4 py-3">
          <h3 class="text-sm font-semibold text-[#E8EAEF]">Parsed JSON</h3>
          <span class="font-mono text-[10px] text-[#8B93A7]">LE · packed</span>
        </div>
        <div class="flex-1 overflow-auto p-4">
          <pre class="mono text-xs leading-6 text-[#E8EAEF]">{{ jsonOutput || '—' }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Device, SchemaField } from '~/types'

const props = defineProps<{
  devices: Device[]
  schemas: Record<string, { schema_definition: SchemaField[] }>
}>()

const { encodeApiKey, encodePayload, parsePayload, toHex, schemaByteLength } = useBinaryParser()

const selectedDeviceId = ref('')
const hexOutput = ref('')
const jsonOutput = ref('')

const selectedDevice = computed(() => props.devices.find((d) => d.id === selectedDeviceId.value))

const schema = computed(
  () => props.schemas[selectedDeviceId.value]?.schema_definition || ([] as SchemaField[]),
)

const canSimulate = computed(() => !!selectedDevice.value && schema.value.length > 0)

const totalBytes = computed(() => {
  if (!schema.value.length) return 0
  try {
    return 16 + schemaByteLength(schema.value)
  } catch {
    return 0
  }
})

function randomValues(fields: SchemaField[]): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}
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
    }
  }
  return out
}

function simulate() {
  if (!selectedDevice.value || !schema.value.length) return

  const values = randomValues(schema.value)
  const keyBytes = encodeApiKey(selectedDevice.value.api_key)
  const payload = encodePayload(values, schema.value)
  const frame = new Uint8Array(keyBytes.length + payload.length)
  frame.set(keyBytes, 0)
  frame.set(payload, keyBytes.length)

  const keyHex = toHex(keyBytes)
  const payloadHex = toHex(payload)
  hexOutput.value = `${keyHex}\n\n${payloadHex}`

  const parsed = parsePayload(payload, schema.value)
  jsonOutput.value = JSON.stringify(
    {
      api_key: selectedDevice.value.api_key,
      device: selectedDevice.value.name,
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

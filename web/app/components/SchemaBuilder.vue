<template>
  <div class="flex min-h-full flex-col gap-4">
    <div class="flex shrink-0 flex-wrap items-end gap-3">
      <div class="min-w-[180px] flex-1">
        <label class="label">Device</label>
        <select v-model="selectedDeviceId" class="input" :disabled="!devices.length">
          <option disabled value="">
            {{ devices.length ? 'Select device' : 'No devices' }}
          </option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <button type="button" class="btn-primary" :disabled="!canEdit" @click="addField">
        + Add field
      </button>
      <button type="button" class="btn-ghost" :disabled="!canEdit || saving" @click="save">
        {{ saving ? 'Saving…' : 'Save schema' }}
      </button>
    </div>

    <div v-if="!selectedDeviceId" class="card flex flex-1 items-center justify-center p-8">
      <p class="text-sm text-[#8B93A7]">
        {{ devices.length ? 'Select a device to edit its packed struct layout.' : 'Create a device first, then define its schema here.' }}
      </p>
    </div>

    <template v-else>
      <!-- ChaCha20 encryption -->
      <div class="card shrink-0 p-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-[#E8EAEF]">Enable ChaCha20 Edge Encryption</p>
            <p class="mt-1 text-xs leading-relaxed text-[#8B93A7]">
              Scramble the packed payload on-device without TLS handshake overhead. Struct
              descrambles at the gateway before JSON routing.
            </p>
          </div>
          <button
            type="button"
            class="relative h-7 w-12 shrink-0 rounded-full transition"
            :class="encryptionOn ? 'bg-[#00FFA3]' : 'bg-[#2A2F3A]'"
            :aria-pressed="encryptionOn"
            :disabled="togglingEnc"
            @click="onToggleEncryption"
          >
            <span
              class="absolute top-0.5 h-6 w-6 rounded-full bg-[#0F1115] shadow transition"
              :class="encryptionOn ? 'left-[1.35rem]' : 'left-0.5'"
            />
          </button>
        </div>

        <div v-if="encryptionOn && selectedDevice?.encryption_key" class="mt-4">
          <div class="mb-1.5 flex items-center justify-between">
            <p class="label mb-0">Device secret key (paste into ESP32)</p>
            <div class="flex gap-2">
              <button type="button" class="btn-ghost py-1 text-[10px]" @click="copyKey">
                {{ keyCopied ? 'Copied' : 'Copy' }}
              </button>
              <button
                type="button"
                class="btn-ghost py-1 text-[10px]"
                :disabled="rotating"
                @click="onRotate"
              >
                {{ rotating ? 'Rotating…' : 'Rotate' }}
              </button>
            </div>
          </div>
          <pre class="mono overflow-x-auto rounded-lg bg-[#0F1115] p-3 text-xs text-[#00FFA3]">{{ selectedDevice.encryption_key }}</pre>
          <p class="mt-2 font-mono text-[10px] text-[#8B93A7]">
            Wire: [16B api_key][12B nonce][ciphertext][16B Poly1305 tag]
          </p>
        </div>
        <p v-if="encMsg" class="mt-3 text-xs" :class="encErr ? 'text-red-400' : 'text-[#00FFA3]'">
          {{ encMsg }}
        </p>
      </div>

      <div class="card flex-1 overflow-auto p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-[#E8EAEF]">Fields</h3>
          <p class="font-mono text-[10px] text-[#8B93A7]">
            sizeof = {{ byteLength }} bytes
          </p>
        </div>

        <div
          v-if="!fields.length"
          class="rounded-lg border border-dashed border-[#2A2F3A] px-4 py-8 text-center"
        >
          <p class="mb-4 text-sm text-[#8B93A7]">
            No fields yet — add the packed struct members for this device.
          </p>
          <button type="button" class="btn-primary" @click="addField">Add first field</button>
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="(field, idx) in fields"
            :key="idx"
            class="grid grid-cols-[1fr_140px_36px] items-center gap-2"
          >
            <input
              v-model="field.name"
              class="input mono"
              placeholder="field_name"
              pattern="[A-Za-z_][A-Za-z0-9_]*"
            />
            <select v-model="field.type" class="input">
              <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <button
              type="button"
              class="btn-ghost px-0 text-[#8B93A7] hover:text-red-400"
              title="Remove field"
              @click="removeField(idx)"
            >
              ×
            </button>
          </div>

          <button
            type="button"
            class="btn-ghost mt-4 w-full border-dashed border-[#2A2F3A]"
            @click="addField"
          >
            + Add field
          </button>
        </div>
      </div>

      <div class="card shrink-0 p-4">
        <p class="label">C++ preview</p>
        <pre class="mono overflow-x-auto rounded-lg bg-[#0F1115] p-3 text-xs leading-relaxed text-[#00FFA3]">{{ cppPreview }}</pre>
      </div>

      <p v-if="message" class="text-xs" :class="error ? 'text-red-400' : 'text-[#00FFA3]'">
        {{ message }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Device, SchemaField } from '~/types'
import { FIELD_TYPES } from '~/types'

const props = defineProps<{
  devices: Device[]
  schemas: Record<string, { schema_definition: SchemaField[] }>
}>()

const { saveSchema, setDeviceEncryption, rotateEncryptionKey } = useDevices()
const selectedDeviceId = useState('schema-selected-device', () => '')
const fields = ref<SchemaField[]>([])
const saving = ref(false)
const message = ref('')
const error = ref(false)

const togglingEnc = ref(false)
const rotating = ref(false)
const keyCopied = ref(false)
const encMsg = ref('')
const encErr = ref(false)

const { schemaByteLength } = useBinaryParser()

const canEdit = computed(() => !!selectedDeviceId.value && props.devices.some((d) => d.id === selectedDeviceId.value))
const selectedDevice = computed(() => props.devices.find((d) => d.id === selectedDeviceId.value))
const encryptionOn = computed(() => !!selectedDevice.value?.encryption_enabled)

function normalizeFields(def: unknown): SchemaField[] {
  if (!Array.isArray(def)) return []
  return toRaw(def).map((f) => ({ name: f.name, type: f.type }))
}

function loadFields(id: string, clearMessage = true) {
  if (clearMessage) message.value = ''
  fields.value = normalizeFields(props.schemas[id]?.schema_definition)
}

function ensureSelection() {
  if (!props.devices.length) {
    selectedDeviceId.value = ''
    fields.value = []
    return
  }
  const stillValid = props.devices.some((d) => d.id === selectedDeviceId.value)
  if (!stillValid) {
    selectedDeviceId.value = props.devices[0]!.id
  }
  loadFields(selectedDeviceId.value, false)
}

watch(selectedDeviceId, (id) => {
  if (id) {
    loadFields(id)
    encMsg.value = ''
  } else {
    fields.value = []
    message.value = ''
  }
})

watch(
  () => props.devices.map((d) => d.id).join(','),
  () => ensureSelection(),
  { immediate: true },
)

watch(
  () => (selectedDeviceId.value ? props.schemas[selectedDeviceId.value] : undefined),
  (schema, prev) => {
    if (selectedDeviceId.value && schema && !prev) {
      loadFields(selectedDeviceId.value, false)
    }
  },
)

const byteLength = computed(() => {
  try {
    return schemaByteLength(fields.value)
  } catch {
    return 0
  }
})

const cppPreview = computed(() => {
  if (!fields.value.length) {
    return '#pragma pack(push, 1)\nstruct Packet {\n  // add fields…\n};\n#pragma pack(pop)'
  }
  const lines = fields.value.map((f) => {
    const map: Record<string, string> = {
      float32: 'float',
      int32: 'int32_t',
      uint8: 'uint8_t',
      boolean: 'uint8_t',
    }
    return `  ${map[f.type] || 'uint8_t'} ${f.name || 'unnamed'};`
  })
  return `#pragma pack(push, 1)\nstruct Packet {\n${lines.join('\n')}\n};\n#pragma pack(pop)\n// sizeof(Packet) == ${byteLength.value}`
})

function addField() {
  if (!canEdit.value) return
  fields.value.push({ name: `field_${fields.value.length}`, type: 'float32' })
}

function removeField(idx: number) {
  fields.value.splice(idx, 1)
}

async function save() {
  if (!canEdit.value) return
  const cleaned = fields.value
    .map((f) => ({ name: f.name.trim(), type: f.type }))
    .filter((f) => f.name)

  if (cleaned.some((f) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name))) {
    error.value = true
    message.value = 'Field names must be valid C identifiers.'
    return
  }

  saving.value = true
  message.value = ''
  error.value = false
  try {
    await saveSchema(selectedDeviceId.value, cleaned)
    message.value = `Saved ${cleaned.length} fields (${schemaByteLength(cleaned)} bytes).`
  } catch (e: any) {
    error.value = true
    message.value = e.message || 'Save failed'
  } finally {
    saving.value = false
  }
}

async function onToggleEncryption() {
  if (!selectedDeviceId.value) return
  togglingEnc.value = true
  encMsg.value = ''
  encErr.value = false
  try {
    const next = !encryptionOn.value
    await setDeviceEncryption(selectedDeviceId.value, next)
    encMsg.value = next
      ? 'ChaCha20 enabled — paste the key into your firmware.'
      : 'ChaCha20 disabled — payloads expected plaintext.'
  } catch (e: any) {
    encErr.value = true
    encMsg.value = e.message || 'Failed to update encryption'
  } finally {
    togglingEnc.value = false
  }
}

async function onRotate() {
  if (!selectedDeviceId.value) return
  if (!confirm('Rotate key? Devices with the old key will fail to decrypt until reflashed.')) return
  rotating.value = true
  encErr.value = false
  try {
    await rotateEncryptionKey(selectedDeviceId.value)
    encMsg.value = 'New key generated.'
  } catch (e: any) {
    encErr.value = true
    encMsg.value = e.message || 'Rotate failed'
  } finally {
    rotating.value = false
  }
}

async function copyKey() {
  const key = selectedDevice.value?.encryption_key
  if (!key) return
  await navigator.clipboard.writeText(key)
  keyCopied.value = true
  setTimeout(() => {
    keyCopied.value = false
  }, 1500)
}
</script>

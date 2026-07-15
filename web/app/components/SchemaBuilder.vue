<template>
  <div class="flex min-h-full flex-col gap-4">
    <div class="flex shrink-0 flex-wrap items-end gap-2 sm:gap-3">
      <div class="min-w-0 w-full flex-1 sm:min-w-[180px]">
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
      <button
        type="button"
        class="btn-ghost w-full sm:w-auto"
        :disabled="!canDownload"
        title="Download ESP32 .h with packed struct + schema version"
        @click="downloadHeader"
      >
        Download C++ Header
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
              descrambles at the gateway before JSON routing. Encrypted frames include a
              4-byte unix timestamp (replay protection).
            </p>
            <p v-if="!canUseEncryption" class="mt-2 text-xs text-amber-300">
              ChaCha20 encryption requires Pro or higher.
              <NuxtLink to="/dashboard/settings" class="underline">View plans</NuxtLink>
            </p>
          </div>
          <button
            type="button"
            class="relative h-7 w-12 shrink-0 rounded-full transition"
            :class="encryptionOn ? 'bg-[#38B6FF]' : 'bg-[#2A2F3A]'"
            :aria-pressed="encryptionOn"
            :disabled="togglingEnc || !canWrite || (!canUseEncryption && !encryptionOn)"
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
                :disabled="rotating || !canWrite || !canUseEncryption"
                @click="onRotate"
              >
                {{ rotating ? 'Rotating…' : 'Rotate' }}
              </button>
            </div>
          </div>
          <pre class="mono overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#0F1115] p-3 text-xs text-[#38B6FF]">{{ selectedDevice.encryption_key }}</pre>
          <p class="mt-2 font-mono text-[10px] text-[#8B93A7]">
            Wire: [16B api_key][1B version][12B nonce][4B ts + struct ciphertext][16B tag]
          </p>
        </div>
        <p v-if="encMsg" class="mt-3 text-xs" :class="encErr ? 'text-red-400' : 'text-[#38B6FF]'">
          {{ encMsg }}
        </p>
      </div>

      <div class="card flex-1 overflow-auto p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-[#E8EAEF]">Fields</h3>
            <p class="mt-0.5 font-mono text-[10px] text-[#8B93A7]">
              schema version {{ displayVersion }}
              <span v-if="willBumpOnSave" class="text-[#38B6FF]"> → {{ displayVersion + 1 }} on save</span>
            </p>
          </div>
          <p class="font-mono text-[10px] text-[#8B93A7]">
            sizeof = {{ byteLength }} bytes
          </p>
        </div>

        <div
          v-if="versionHistory.length > 1"
          class="mb-4 flex flex-wrap gap-2"
        >
          <span
            v-for="v in versionHistory"
            :key="v.version"
            class="rounded border border-[#2A2F3A] px-2 py-0.5 font-mono text-[10px]"
            :class="v.version === publishedVersion ? 'border-[#38B6FF]/60 text-[#38B6FF]' : 'text-[#8B93A7]'"
            :title="`${v.schema_definition.length} fields`"
          >
            v{{ v.version }}{{ v.version === publishedVersion ? ' · current' : '' }}
          </span>
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

        <div v-else class="space-y-3">
          <div
            v-for="(field, idx) in fields"
            :key="idx"
            class="rounded-lg border border-[#2A2F3A] p-3"
          >
            <div class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_140px_40px]">
              <input
                v-model="field.name"
                class="input mono"
                placeholder="field_name"
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                :disabled="!canWrite"
              />
              <select
                :value="field.type"
                class="input"
                :disabled="!canWrite"
                @change="onTypeChange(idx, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <button
                type="button"
                class="btn-ghost min-h-10 text-[#8B93A7] hover:text-red-400 sm:min-h-0 sm:px-0"
                title="Remove field"
                :disabled="!canWrite"
                @click="removeField(idx)"
              >
                ×
              </button>
            </div>

            <div v-if="field.type === 'flags'" class="mt-3 space-y-2 border-t border-[#2A2F3A] pt-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] uppercase tracking-wider text-[#8B93A7]">
                  Packed flags · 1 byte · bits 0–7
                </p>
                <button
                  type="button"
                  class="btn-ghost py-1 text-[10px]"
                  :disabled="!canWrite || (field.bits?.length || 0) >= 8"
                  @click="addFlagBit(idx)"
                >
                  + Flag
                </button>
              </div>
              <div
                v-for="(bit, bIdx) in field.bits || []"
                :key="bIdx"
                class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_80px_40px]"
              >
                <input
                  v-model="bit.name"
                  class="input mono text-xs"
                  placeholder="flag_name"
                  :disabled="!canWrite"
                />
                <input
                  v-model.number="bit.bit"
                  type="number"
                  min="0"
                  max="7"
                  class="input mono text-xs"
                  :disabled="!canWrite"
                />
                <button
                  type="button"
                  class="btn-ghost min-h-10 text-[#8B93A7] hover:text-red-400 sm:min-h-0 sm:px-0"
                  title="Remove flag"
                  :disabled="!canWrite"
                  @click="removeFlagBit(idx, bIdx)"
                >
                  ×
                </button>
              </div>
              <p v-if="!(field.bits && field.bits.length)" class="text-[10px] text-amber-300">
                Add at least one flag bit (positions must be unique 0–7).
              </p>
            </div>
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
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p class="label mb-0">C++ preview</p>
          <button
            type="button"
            class="btn-ghost py-1 text-[10px]"
            :disabled="!canDownload"
            @click="downloadHeader"
          >
            Download .h
          </button>
        </div>
        <pre class="mono overflow-x-auto rounded-lg bg-[#0F1115] p-3 text-xs leading-relaxed text-[#38B6FF]">{{ cppPreviewText }}</pre>
        <p class="mt-2 text-[10px] leading-relaxed text-[#8B93A7]">
          Changing a field type (e.g. int32 → float32) publishes a new schema version.
          Old devices keep sending their version byte; the gateway routes each packet to
          the matching immutable layout.
        </p>
      </div>

      <p v-if="message" class="text-xs" :class="error ? 'text-red-400' : 'text-[#38B6FF]'">
        {{ message }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Device, DeviceSchema, FieldType, SchemaField, SchemaVersion } from '~/types'
import { FIELD_TYPES } from '~/types'

const props = defineProps<{
  devices: Device[]
  schemas: Record<string, DeviceSchema>
  schemaVersions?: Record<string, SchemaVersion[]>
}>()

const { saveSchema, setDeviceEncryption, rotateEncryptionKey } = useDevices()
const { canWrite } = useOrganization()
const { hasEntitlement } = useEntitlements()
const canUseEncryption = computed(() => hasEntitlement('chacha20'))
const { generateCppHeader, downloadCppHeader, headerFilename, cppPreview } = useCppHeader()
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

const canEdit = computed(
  () =>
    canWrite.value &&
    !!selectedDeviceId.value &&
    props.devices.some((d) => d.id === selectedDeviceId.value),
)
const selectedDevice = computed(() => props.devices.find((d) => d.id === selectedDeviceId.value))
const encryptionOn = computed(() => !!selectedDevice.value?.encryption_enabled)

const publishedVersion = computed(() => props.schemas[selectedDeviceId.value]?.version || 1)
const publishedDef = computed(
  () => props.schemas[selectedDeviceId.value]?.schema_definition || ([] as SchemaField[]),
)

const dirty = computed(() => {
  return JSON.stringify(publishedDef.value) !== JSON.stringify(cleanedFields())
})

const willBumpOnSave = computed(() => dirty.value && publishedDef.value.length > 0)
const displayVersion = computed(() => publishedVersion.value)
const exportVersion = computed(() =>
  willBumpOnSave.value ? publishedVersion.value + 1 : publishedVersion.value,
)

const versionHistory = computed(() => props.schemaVersions?.[selectedDeviceId.value] || [])

const canDownload = computed(() => {
  return (
    !!selectedDevice.value &&
    fields.value.some((f) => f.name.trim() && /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name.trim()))
  )
})

function normalizeFields(def: unknown): SchemaField[] {
  if (!Array.isArray(def)) return []
  return toRaw(def).map((raw: any) => {
    if (raw?.type === 'flags') {
      const bits = Array.isArray(raw.bits)
        ? raw.bits.map((b: any) => ({
            name: String(b?.name || ''),
            bit: Number(b?.bit) | 0,
          }))
        : []
      return { name: String(raw.name || ''), type: 'flags' as const, bits }
    }
    return { name: String(raw?.name || ''), type: raw?.type || 'float32' }
  })
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

const cppPreviewText = computed(() =>
  cppPreview(fields.value, exportVersion.value, byteLength.value),
)

function cleanedFields(): SchemaField[] {
  const out: SchemaField[] = []
  for (const f of fields.value) {
    const name = f.name.trim()
    if (!name) continue
    if (f.type === 'flags') {
      out.push({
        name,
        type: 'flags',
        bits: (f.bits || [])
          .map((b) => ({ name: String(b.name || '').trim(), bit: Number(b.bit) | 0 }))
          .filter((b) => b.name),
      })
    } else {
      out.push({ name, type: f.type })
    }
  }
  return out
}

function validateFlags(fieldsToCheck: SchemaField[]): string | null {
  for (const f of fieldsToCheck) {
    if (f.type !== 'flags') continue
    if (!f.bits.length) return `Flags field "${f.name}" needs at least one bit.`
    const seen = new Set<number>()
    for (const bit of f.bits) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bit.name)) {
        return `Flag name "${bit.name}" must be a valid C identifier.`
      }
      if (!Number.isInteger(bit.bit) || bit.bit < 0 || bit.bit > 7) {
        return `Flags field "${f.name}": bit positions must be 0–7.`
      }
      if (seen.has(bit.bit)) {
        return `Flags field "${f.name}": duplicate bit position ${bit.bit}.`
      }
      seen.add(bit.bit)
    }
  }
  return null
}

function addField() {
  if (!canEdit.value) return
  fields.value.push({ name: `field_${fields.value.length}`, type: 'float32' })
}

function removeField(idx: number) {
  fields.value.splice(idx, 1)
}

function onTypeChange(idx: number, next: string) {
  const type = next as FieldType
  const current = fields.value[idx]
  if (!current) return
  if (type === 'flags') {
    fields.value[idx] = {
      name: current.name,
      type: 'flags',
      bits: current.type === 'flags' && current.bits?.length
        ? current.bits
        : [{ name: 'flag_0', bit: 0 }],
    }
  } else {
    fields.value[idx] = { name: current.name, type }
  }
}

function addFlagBit(fieldIdx: number) {
  const field = fields.value[fieldIdx]
  if (!field || field.type !== 'flags') return
  if (!field.bits) field.bits = []
  if (field.bits.length >= 8) return
  const used = new Set(field.bits.map((b) => Number(b.bit)))
  let nextBit = 0
  while (used.has(nextBit) && nextBit < 8) nextBit += 1
  if (nextBit > 7) return
  field.bits.push({ name: `flag_${nextBit}`, bit: nextBit })
}

function removeFlagBit(fieldIdx: number, bitIdx: number) {
  const field = fields.value[fieldIdx]
  if (!field || field.type !== 'flags') return
  field.bits.splice(bitIdx, 1)
}

async function save() {
  if (!canEdit.value) return
  const cleaned = cleanedFields()

  if (cleaned.some((f) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name))) {
    error.value = true
    message.value = 'Field names must be valid C identifiers.'
    return
  }

  const flagsErr = validateFlags(cleaned)
  if (flagsErr) {
    error.value = true
    message.value = flagsErr
    return
  }

  saving.value = true
  message.value = ''
  error.value = false
  try {
    const saved = await saveSchema(selectedDeviceId.value, cleaned)
    message.value = `Saved v${saved.version} · ${cleaned.length} fields (${schemaByteLength(cleaned)} bytes). Old versions stay active for devices still on them.`
  } catch (e: any) {
    error.value = true
    message.value = e.message || 'Save failed'
  } finally {
    saving.value = false
  }
}

function downloadHeader() {
  if (!selectedDevice.value || !canDownload.value) return
  const cleaned = cleanedFields()
  if (!cleaned.length) return

  if (cleaned.some((f) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name))) {
    error.value = true
    message.value = 'Field names must be valid C identifiers before download.'
    return
  }

  const flagsErr = validateFlags(cleaned)
  if (flagsErr) {
    error.value = true
    message.value = flagsErr
    return
  }

  const version = exportVersion.value
  const contents = generateCppHeader({
    deviceName: selectedDevice.value.name,
    version,
    fields: cleaned,
    encryptionEnabled: encryptionOn.value,
  })
  downloadCppHeader(headerFilename(selectedDevice.value.name, version), contents)
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
      ? 'ChaCha20 enabled — include a unix timestamp in the plaintext and paste the key into firmware.'
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

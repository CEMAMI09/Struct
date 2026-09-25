<template>
  <div class="flex min-h-full flex-col gap-4">
    <div class="flex shrink-0 flex-wrap items-end gap-2 sm:gap-3">
      <div class="min-w-0 w-full flex-1 sm:min-w-[180px]">
        <label class="label" for="schema-device">Device</label>
        <select id="schema-device" v-model="selectedDeviceId" class="input" :disabled="!devices.length">
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
        title="Save schema changes before downloading an encoder"
        @click="downloadHeader"
      >
        Download {{ codeLanguage }} encoder
      </button>
    </div>

    <div v-if="!selectedDeviceId" class="card flex flex-1 items-center justify-center p-8">
      <p class="text-sm text-[#8B93A7]">
        {{ devices.length ? 'Select a device to edit its packed struct layout.' : 'Create a device first, then define its schema here.' }}
      </p>
    </div>

    <template v-else>
      <!-- ChaCha20 encryption -->
      <div class="card order-3 shrink-0 p-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-[#E8EAEF]">Enable ChaCha20 Edge Encryption</p>
            <p class="mt-1 text-xs leading-relaxed text-[#8B93A7]">
              Encrypt the packed payload on-device with ChaCha20-Poly1305. Struct
              authenticates and decrypts it at the gateway before JSON routing. Encrypted frames include a
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
            :class="encryptionOn ? 'bg-[#5617fc]' : 'bg-[#2A2F3A]'"
            :aria-pressed="encryptionOn"
            aria-label="Enable payload encryption"
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
          <pre class="mono overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#0F1115] p-3 text-xs text-[#b79bff]">{{ selectedDevice.encryption_key }}</pre>
          <p class="mt-2 font-mono text-[10px] text-[#8B93A7]">
            Wire: [protocol][16B key_id][schema][4B ts][12B nonce][12B encryption nonce][4B ts + struct ciphertext][16B tag][32B HMAC]
          </p>
        </div>
        <p v-if="encMsg" class="mt-3 text-xs" :class="encErr ? 'text-red-400' : 'text-[#b79bff]'">
          {{ encMsg }}
        </p>
      </div>

      <div class="card order-1 flex-1 overflow-auto p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-[#E8EAEF]">Fields</h3>
            <p class="mt-0.5 font-mono text-[10px] text-[#8B93A7]">
              schema version {{ displayVersion }}
              <span v-if="willBumpOnSave" class="text-[#b79bff]"> → {{ displayVersion + 1 }} on save</span>
            </p>
          </div>
          <p class="font-mono text-[10px] text-[#8B93A7]">
            payload = {{ byteLength }} bytes
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
            :class="v.version === publishedVersion ? 'border-[#3a4050] text-[#E8EAEF]' : 'text-[#8B93A7]'"
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
                :aria-label="`Field ${idx + 1} name`"
                class="input mono"
                placeholder="field_name"
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                :disabled="!canWrite"
              />
              <select
                :value="field.type"
                :aria-label="`Field ${idx + 1} type`"
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

            <div
              v-if="field.type === 'char'"
              class="mt-3 grid grid-cols-[1fr_auto] items-center gap-2 border-t border-[#2A2F3A] pt-3"
            >
              <p class="text-xs text-[#8B93A7]">
                char[{{ charLength(field) }}] · fixed byte array
              </p>
              <input
                :value="charLength(field)"
                type="number"
                min="1"
                max="64"
                class="input mono w-24 text-xs"
                :disabled="!canWrite"
                @input="
                  setCharLength(
                    idx,
                    Number(($event.target as HTMLInputElement).value),
                  )
                "
              />
            </div>

            <div v-if="field.type === 'flags'" class="mt-3 space-y-2 border-t border-[#2A2F3A] pt-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-[#8B93A7]">
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

      <div class="card order-2 shrink-0 p-4">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p class="label mb-0">Encoder preview</p>
          <button
            type="button"
            class="btn-ghost py-1 text-[10px]"
            :disabled="!canDownload"
            @click="downloadHeader"
          >
            Download encoder
          </button>
        </div>
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <label for="encoder-language" class="label mb-0">Payload encoder</label>
          <select id="encoder-language" v-model="codeLanguage" class="input w-auto">
            <option v-for="language in CODE_LANGUAGES" :key="language">{{ language }}</option>
          </select>
          <span v-if="dirty" class="text-xs text-amber-300">Preview only — save before downloading.</span>
        </div>
        <p class="mb-3 text-xs text-[#8B93A7]">C, C++ and Arduino encoders work with the Struct C SDK. JavaScript and Python have UDP clients; Rust exports a payload encoder. char fields use fixed raw bytes.</p>
        <p class="mb-3 text-xs text-[#8B93A7]">Send once to minimize radio time, or opt into a signed storage receipt with a fixed retry budget. A timeout means delivery is unknown.</p>
        <pre class="mono overflow-x-auto rounded-lg bg-[#0c0d10] p-3 text-xs leading-relaxed text-[#c5cad3]">{{ cppPreviewText }}</pre>
        <p class="mt-2 text-[10px] leading-relaxed text-[#8B93A7]">
          Changing a field type (e.g. int32 → float32) publishes a new schema version.
          Old devices keep sending their version byte; the gateway routes each packet to
          the matching immutable layout.
        </p>
      </div>

      <div class="card flex flex-wrap gap-4 p-4 text-xs">
        <button class="btn-primary" :disabled="!canDownload || exportingProject" @click="downloadProject">{{ exportingProject ? 'Packaging…' : `Download ${codeLanguage} starter project` }}</button>
        <a href="/sdk/struct-sdk.zip" download class="text-[#b79bff] underline">Download SDK + integration guide</a>
        <a href="/sdk/struct-arduino.zip" download class="text-[#b79bff] underline">Arduino ZIP library (ESP32)</a>
      </div>
      <p v-if="message" role="status" class="text-xs" :class="error ? 'text-red-400' : 'text-[#b79bff]'">
        {{ message }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Device, DeviceSchema, FieldType, SchemaField, SchemaVersion } from '~/types'
import { FIELD_TYPES } from '~/types'
import { CODE_LANGUAGES, generateSchemaCode, validateSchema, type CodeLanguage } from '#shared/schemaCodegen'
import {generateSchemaProject} from '#shared/schemaProject'
const exportingProject=ref(false)
async function downloadProject(){
 if(!canDownload.value||exportingProject.value)return
 exportingProject.value=true
 try{
  const files=generateSchemaProject(cleanedFields(),exportVersion.value,codeLanguage.value,encryptionOn.value)
  const {zipSync,unzipSync,strToU8}=await import('fflate')
  const response=await fetch('/sdk/struct-sdk.zip');if(!response.ok)throw new Error('SDK download unavailable')
  const archive=unzipSync(new Uint8Array(await response.arrayBuffer()))
  for(const [name,source] of Object.entries(files))archive[`project/${name}`]=strToU8(source)
  const blob=new Blob([zipSync(archive)],{type:'application/zip'}),url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download='struct-starter.zip';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }catch(e:any){error.value=true;message.value=e.message||'Unable to export starter project'}finally{exportingProject.value=false}
}

const props = defineProps<{
  devices: Device[]
  schemas: Record<string, DeviceSchema>
  schemaVersions?: Record<string, SchemaVersion[]>
}>()

const { saveSchema, setDeviceEncryption, rotateEncryptionKey } = useDevices()
const { canWrite } = useOrganization()
const { hasEntitlement } = useEntitlements()
const canUseEncryption = computed(() => hasEntitlement('chacha20'))
const { downloadCppHeader } = useCppHeader()
const codeLanguage = ref<CodeLanguage>('C')
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
    !!selectedDevice.value && !dirty.value &&
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
            bit: Number(b?.bit),
          }))
        : []
      return { name: String(raw.name || ''), type: 'flags' as const, bits }
    }
    if (raw?.type === 'char') {
      const length = Math.max(1, Math.min(64, Number(raw.length) || 1))
      return { name: String(raw.name || ''), type: 'char' as const, length }
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

const cppPreviewText = computed(() => {
  try { return generateSchemaCode(cleanedFields(), exportVersion.value, codeLanguage.value, encryptionOn.value).source }
  catch (e: any) { return e.message }
})

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
          .map((b) => ({ name: String(b.name || '').trim(), bit: Number(b.bit) }))
          .filter((b) => b.name),
      })
    } else if (f.type === 'char') {
      out.push({
        name,
        type: 'char',
        length: Math.max(1, Math.min(64, Number(f.length) || 1)),
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
  } else if (type === 'char') {
    fields.value[idx] = {
      name: current.name,
      type: 'char',
      length: current.type === 'char' ? current.length : 6,
    }
  } else {
    fields.value[idx] = { name: current.name, type }
  }
}

function charLength(field: SchemaField) {
  if (field.type !== 'char') return 1
  return Math.max(1, Math.min(64, Number(field.length) || 1))
}

function setCharLength(idx: number, length: number) {
  const field = fields.value[idx]
  if (!field || field.type !== 'char') return
  fields.value[idx] = {
    ...field,
    length: Math.max(1, Math.min(64, Math.floor(Number(length) || 1))),
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
  try { validateSchema(fields.value, encryptionOn.value) }
  catch (e: any) { error.value = true; message.value = e.message; return }

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
  try {
    const code = generateSchemaCode(cleaned, version, codeLanguage.value, encryptionOn.value)
    downloadCppHeader(code.filename, code.source)
  } catch (e: any) { error.value = true; message.value = e.message }

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

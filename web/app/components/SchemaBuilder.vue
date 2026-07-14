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

const { saveSchema } = useDevices()
const selectedDeviceId = useState('schema-selected-device', () => '')
const fields = ref<SchemaField[]>([])
const saving = ref(false)
const message = ref('')
const error = ref(false)

const { schemaByteLength } = useBinaryParser()

const canEdit = computed(() => !!selectedDeviceId.value && props.devices.some((d) => d.id === selectedDeviceId.value))

function normalizeFields(def: unknown): SchemaField[] {
  if (!Array.isArray(def)) return []
  // useState/supabase props are Vue proxies — structuredClone throws on them
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
  if (id) loadFields(id)
  else {
    fields.value = []
    message.value = ''
  }
})

watch(
  () => props.devices.map((d) => d.id).join(','),
  () => ensureSelection(),
  { immediate: true },
)

// Schemas may arrive after the user already picked a device
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
</script>

<script setup lang="ts">
import { makeField, assertEditableFields } from '#shared/protocol-lab/config'
import type { LabField, LabMetadata, ResearchSchema } from '#shared/protocol-lab/types'
const fields = defineModel<LabField[]>({ required: true })
defineProps<{ metadata: LabMetadata | null; optimized: boolean }>()
const emit = defineEmits<{ preset: [ResearchSchema]; reset: [] }>()
const advanced = ref(''),
  advancedError = ref('')
const names: Record<string, string> = {
  bool: 'Boolean',
  int: 'Integer',
  uint: 'Unsigned integer',
  sint: 'ZigZag integer',
  float16: 'Float16',
  float32: 'Float32',
  float64: 'Float64',
  fixed: 'Fixed-point decimal',
  enum: 'Enum',
  bitset: 'Bitset',
  string: 'UTF-8 string',
  timestamp: 'Timestamp (ms)',
  bytes: 'Binary (hex)',
  nested: 'Nested structure',
  null: 'Null',
}
function add() {
  let n = fields.value.length + 1
  while (fields.value.some((f) => f.name === `field_${n}`)) n++
  fields.value.push({ ...makeField(`field_${n}`), id: `field-${Date.now()}` })
}
function move(index: number, by: number) {
  const copy = [...fields.value],
    to = index + by
  if (to < 0 || to >= copy.length) return
  ;[copy[index], copy[to]] = [copy[to]!, copy[index]!]
  fields.value = copy
}
function changeType(f: LabField) {
  f.repeated = false
  f.absent = false
  f.optional = false
  f.value =
    f.type === 'bool'
      ? 'true'
      : f.type === 'enum'
        ? 'active'
        : f.type === 'string'
          ? 'sensor α'
          : f.type === 'bytes'
            ? '00010203'
            : f.type === 'null'
              ? 'null'
              : f.type === 'nested'
                ? '\{"value":1.5\}'
                : ['float16', 'float32', 'float64', 'fixed'].includes(f.type)
                  ? '1.5'
                  : '1'
  if (f.type === 'enum') f.labels = ['off', 'idle', 'active', 'fault']
  if (f.type === 'nested') f.fields = [makeField('value', 'float32', '1.5')]
}
function numeric(f: LabField, key: 'min' | 'max' | 'step', event: Event) {
  const v = (event.target as HTMLInputElement).value
  if (v === '') delete f[key]
  else f[key] = Number(v)
}
function applyAdvanced() {
  try {
    const next = JSON.parse(advanced.value)
    assertEditableFields(next)
    fields.value = next
    advancedError.value = ''
  } catch (error) {
    advancedError.value = error instanceof Error ? error.message : 'Invalid JSON.'
  }
}
</script>
<template>
  <section class="lab-settings-section">
    <div class="lab-section-heading">
      <h2>Telemetry schema</h2>
      <span class="lab-count">{{ fields.length }} fields</span>
    </div>
    <label class="lab-label" for="lab-preset">Example preset</label>
    <select
      id="lab-preset"
      class="lab-input"
      value="custom"
      @change="
        ($event.target as HTMLSelectElement).value === 'original'
          ? emit('reset')
          : emit(
              'preset',
              metadata!.presets.find((p) => p.id === ($event.target as HTMLSelectElement).value)!,
            )
      "
    >
      <option value="custom">Custom schema</option>
      <option value="original">Original ESP32 test</option>
      <option
        v-for="preset in metadata?.presets.filter((p) => p.family === 'preset')"
        :key="preset.id"
        :value="preset.id"
      >
        {{ preset.id.replace('preset-', '').replace(/-/g, ' ') }}
      </option>
    </select>
    <p class="lab-help">Example values, not customer traffic. Field order affects positional encodings.</p>
    <div class="lab-field-list">
      <fieldset v-for="(field, index) in fields" :key="field.id" class="lab-field">
        <legend class="sr-only">Field {{ index + 1 }}</legend>
        <div class="lab-field-title">
          <label class="sr-only" :for="`name-${field.id}`">Field {{ index + 1 }} name</label>
          <input
            :id="`name-${field.id}`"
            v-model="field.name"
            class="lab-input lab-field-name"
            maxlength="64"
            :aria-label="`Field ${index + 1} name`"
          />
          <button
            type="button"
            class="lab-icon"
            :disabled="index === 0"
            :aria-label="`Move ${field.name} up`"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="lab-icon"
            :disabled="index === fields.length - 1"
            :aria-label="`Move ${field.name} down`"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            class="lab-icon"
            :aria-label="`Remove ${field.name}`"
            @click="fields.splice(index, 1)"
          >
            ×
          </button>
        </div>
        <label class="sr-only" :for="`type-${field.id}`">{{ field.name }} type</label>
        <select
          :id="`type-${field.id}`"
          v-model="field.type"
          class="lab-input"
          :aria-label="`${field.name} type`"
          @change="changeType(field)"
        >
          <option v-for="(label, type) in names" :key="type" :value="type">{{ label }}</option>
        </select>
        <div v-if="['int', 'uint', 'sint', 'bitset'].includes(field.type)" class="lab-inline-label">
          <label :for="`width-${field.id}`">Bit width</label
          ><select :id="`width-${field.id}`" v-model.number="field.width" class="lab-input">
            <option v-for="n in [8, 16, 32, 64]" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
        <label class="lab-label" :for="`value-${field.id}`"
          >Sample {{ field.repeated ? 'array' : 'value' }}</label
        >
        <select
          v-if="field.type === 'bool' && !field.repeated"
          :id="`value-${field.id}`"
          v-model="field.value"
          class="lab-input"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
        <select
          v-else-if="field.type === 'enum' && !field.repeated"
          :id="`value-${field.id}`"
          v-model="field.value"
          class="lab-input"
        >
          <option v-for="label in field.labels" :key="label">{{ label }}</option>
        </select>
        <textarea
          v-else
          :id="`value-${field.id}`"
          v-model="field.value"
          class="lab-input lab-value"
          rows="1"
          spellcheck="false"
          :aria-label="`${field.name} sample value`"
        />
        <details
          class="lab-field-options"
          :open="optimized && ['float32', 'float64', 'fixed'].includes(field.type)"
        >
          <summary>Constraints &amp; presence</summary>
          <div v-if="['float32', 'float64', 'fixed'].includes(field.type)" class="lab-range-grid">
            <label
              >Minimum<input
                type="number"
                class="lab-input"
                :value="field.min"
                :aria-label="`${field.name} minimum`"
                @input="numeric(field, 'min', $event)"
            /></label>
            <label
              >Maximum<input
                type="number"
                class="lab-input"
                :value="field.max"
                :aria-label="`${field.name} maximum`"
                @input="numeric(field, 'max', $event)"
            /></label>
            <label
              >Step<input
                type="number"
                class="lab-input"
                :value="field.step"
                min="0"
                step="any"
                :aria-label="`${field.name} precision step`"
                @input="numeric(field, 'step', $event)"
            /></label>
          </div>
          <label v-if="field.type === 'enum'" class="lab-label"
            >Enum labels (comma separated)<input
              class="lab-input"
              :value="field.labels?.join(',')"
              @change="
                field.labels = ($event.target as HTMLInputElement).value.split(',').map((s) => s.trim())
              "
          /></label>
          <label class="lab-check"
            ><input v-model="field.optional" type="checkbox" @change="field.absent = false" />Optional
            field</label
          >
          <label v-if="field.optional" class="lab-check"
            ><input v-model="field.absent" type="checkbox" />Absent in this sample</label
          >
          <label class="lab-check"
            ><input v-model="field.repeated" type="checkbox" />Repeated (sample must be a JSON array)</label
          >
          <p class="lab-help">
            Unsupported Struct types remain unsupported. Edit nested field definitions in schema JSON below.
          </p>
        </details>
      </fieldset>
    </div>
    <button type="button" class="lab-button lab-add" :disabled="fields.length >= 128" @click="add">
      + Add field
    </button>
    <details class="lab-subdetails" @toggle="advanced = JSON.stringify(fields, null, 2)">
      <summary>Edit schema JSON</summary>
      <textarea
        v-model="advanced"
        class="lab-input lab-code"
        rows="10"
        aria-label="Advanced schema JSON"
      /><button type="button" class="lab-button" @click="applyAdvanced">Apply schema</button>
      <p v-if="advancedError" role="alert" class="lab-error">{{ advancedError }}</p>
    </details>
  </section>
</template>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold text-[#E8EAEF]">Packed struct layout</h3>
        <p class="mt-0.5 font-mono text-[10px] text-[#8B93A7]">
          sizeof = {{ byteLength }} bytes · identity field
          <span class="text-[#38B6FF]">{{ identityField || '—' }}</span>
        </p>
      </div>
      <button type="button" class="btn-primary" :disabled="disabled" @click="addField">
        + Add field
      </button>
    </div>

    <div
      v-if="!modelValue.length"
      class="rounded-lg border border-dashed border-[#2A2F3A] px-4 py-8 text-center"
    >
      <p class="mb-4 text-sm text-[#8B93A7]">
        Map the C-struct members for this hardware fleet (e.g.
        <span class="font-mono text-[#E8EAEF]">char device_id[6]</span>,
        <span class="font-mono text-[#E8EAEF]">uint8_t battery_level</span>).
      </p>
      <button type="button" class="btn-primary" :disabled="disabled" @click="addField">
        Add first field
      </button>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="(field, idx) in modelValue"
        :key="idx"
        class="rounded-lg border border-[#2A2F3A] p-3"
      >
        <div class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_140px_auto_40px]">
          <input
            :value="field.name"
            class="input mono"
            placeholder="field_name"
            pattern="[A-Za-z_][A-Za-z0-9_]*"
            :disabled="disabled"
            @input="patchField(idx, { name: ($event.target as HTMLInputElement).value })"
          />
          <select
            :value="field.type"
            class="input"
            :disabled="disabled"
            @change="onTypeChange(idx, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
          <label
            class="flex items-center gap-1.5 font-mono text-[10px] text-[#8B93A7]"
            :title="'Wire identity used for zero-touch registration'"
          >
            <input
              type="radio"
              name="identity-field"
              class="accent-[#38B6FF]"
              :checked="identityField === field.name"
              :disabled="disabled || !field.name.trim()"
              @change="emit('update:identityField', field.name.trim())"
            />
            id
          </label>
          <button
            type="button"
            class="btn-ghost min-h-10 text-[#8B93A7] hover:text-red-400 sm:min-h-0 sm:px-0"
            title="Remove field"
            :disabled="disabled"
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
            :disabled="disabled"
            @input="
              patchField(idx, {
                length: clampLength(Number(($event.target as HTMLInputElement).value)),
              })
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
              :disabled="disabled || ((field as any).bits?.length || 0) >= 8"
              @click="addFlagBit(idx)"
            >
              + Flag
            </button>
          </div>
          <div
            v-for="(bit, bIdx) in (field as any).bits || []"
            :key="bIdx"
            class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_80px_40px]"
          >
            <input
              :value="bit.name"
              class="input mono text-xs"
              placeholder="flag_name"
              :disabled="disabled"
              @input="
                patchFlag(idx, bIdx, {
                  name: ($event.target as HTMLInputElement).value,
                })
              "
            />
            <input
              :value="bit.bit"
              type="number"
              min="0"
              max="7"
              class="input mono text-xs"
              :disabled="disabled"
              @input="
                patchFlag(idx, bIdx, {
                  bit: Number(($event.target as HTMLInputElement).value) | 0,
                })
              "
            />
            <button
              type="button"
              class="btn-ghost min-h-10 text-[#8B93A7] hover:text-red-400 sm:min-h-0 sm:px-0"
              :disabled="disabled"
              @click="removeFlagBit(idx, bIdx)"
            >
              ×
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="btn-ghost w-full border-dashed border-[#2A2F3A]"
        :disabled="disabled"
        @click="addField"
      >
        + Add field
      </button>
    </div>

    <div class="card shrink-0 p-4">
      <p class="label mb-2">C++ preview</p>
      <pre
        class="mono overflow-x-auto rounded-lg bg-[#0F1115] p-3 text-xs leading-relaxed text-[#38B6FF]"
      >{{ cppPreviewText }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FieldType, SchemaField } from '~/types'
import { FIELD_TYPES, fieldByteLength } from '~/types'

const props = defineProps<{
  modelValue: SchemaField[]
  identityField: string
  disabled?: boolean
  profileName?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [SchemaField[]]
  'update:identityField': [string]
}>()

const { cppPreview } = useCppHeader()

const byteLength = computed(() => {
  try {
    return props.modelValue.reduce((sum, f) => sum + fieldByteLength(f), 0)
  } catch {
    return 0
  }
})

const cppPreviewText = computed(() =>
  cppPreview(props.modelValue, 1, byteLength.value),
)

function clampLength(n: number) {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(64, Math.floor(n)))
}

function charLength(field: SchemaField) {
  if (field.type !== 'char') return 1
  return clampLength(Number(field.length) || 1)
}

function replace(next: SchemaField[]) {
  emit('update:modelValue', next)
}

function patchField(idx: number, patch: Record<string, unknown>) {
  const next = props.modelValue.map((f, i) => (i === idx ? ({ ...f, ...patch } as SchemaField) : f))
  replace(next)
}

function onTypeChange(idx: number, type: string) {
  const name = props.modelValue[idx]?.name || ''
  let next: SchemaField
  if (type === 'flags') {
    next = { name, type: 'flags', bits: [{ name: 'flag0', bit: 0 }] }
  } else if (type === 'char') {
    next = { name, type: 'char', length: 6 }
  } else {
    next = { name, type: type as Exclude<FieldType, 'flags' | 'char'> }
  }
  const list = [...props.modelValue]
  list[idx] = next
  replace(list)
}

function addField() {
  replace([...props.modelValue, { name: '', type: 'uint8' }])
}

function removeField(idx: number) {
  const removed = props.modelValue[idx]
  const next = props.modelValue.filter((_, i) => i !== idx)
  replace(next)
  if (removed && props.identityField === removed.name) {
    emit('update:identityField', next.find((f) => f.name.trim())?.name || 'device_id')
  }
}

function addFlagBit(idx: number) {
  const field = props.modelValue[idx]
  if (!field || field.type !== 'flags') return
  const used = new Set(field.bits.map((b) => Number(b.bit)))
  let bit = 0
  while (used.has(bit) && bit < 8) bit += 1
  if (bit > 7) return
  patchField(idx, {
    bits: [...field.bits, { name: `flag${bit}`, bit }],
  })
}

function patchFlag(idx: number, bIdx: number, patch: { name?: string; bit?: number }) {
  const field = props.modelValue[idx]
  if (!field || field.type !== 'flags') return
  const bits = field.bits.map((b, i) => (i === bIdx ? { ...b, ...patch } : b))
  patchField(idx, { bits })
}

function removeFlagBit(idx: number, bIdx: number) {
  const field = props.modelValue[idx]
  if (!field || field.type !== 'flags') return
  patchField(idx, { bits: field.bits.filter((_, i) => i !== bIdx) })
}
</script>

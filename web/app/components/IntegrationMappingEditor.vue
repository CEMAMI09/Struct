<template>
  <div class="space-y-3">
    <label class="label" for="integration-format">Event format</label
    ><select id="integration-format" v-model="model.format" class="input">
      <option value="envelope-v1">Versioned envelope with data object</option>
      <option value="flat-v1">Flat object with stable event_id</option>
    </select>
    <p class="text-xs text-[#9AA3B2]">
      No selected fields means all telemetry fields. Add rows to select and
      rename only those fields. event_id, event_type and format_version are
      always included.
    </p>
    <div
      v-for="(field, index) in model.fields"
      :key="index"
      class="space-y-2 rounded-lg border border-[#2A2F3A] p-3"
    >
      <label class="label" :for="`mapping-from-${index}`"
        >Source field path</label
      ><input
        :id="`mapping-from-${index}`"
        v-model="field.from"
        class="input mono"
        placeholder="temperature"
      />
      <label class="label" :for="`mapping-to-${index}`">Destination field</label
      ><input
        :id="`mapping-to-${index}`"
        v-model="field.to"
        class="input mono"
        placeholder="temperature_celsius"
      />
      <label class="label" :for="`mapping-convert-${index}`">Conversion</label
      ><select
        :id="`mapping-convert-${index}`"
        v-model="field.convert"
        class="input"
      >
        <option value="identity">Preserve value and type</option>
        <option value="string">Scalar to text</option>
        <option value="boolean">Explicit boolean / 0 or 1</option>
      </select>
      <label class="flex items-center gap-2 text-xs"
        ><input v-model="field.required" type="checkbox" />Required field</label
      ><button
        type="button"
        class="btn-ghost text-xs"
        @click="model.fields.splice(index, 1)"
      >
        Remove field {{ index + 1 }}
      </button>
    </div>
    <button
      type="button"
      class="btn-ghost text-xs"
      :disabled="model.fields.length >= 100"
      @click="add"
    >
      Select / rename field
    </button>
    <fieldset class="flex flex-wrap gap-3">
      <legend class="label">Include metadata</legend>
      <label
        v-for="m in ['device_id', 'timestamp', 'schema']"
        :key="m"
        class="flex items-center gap-2 text-xs"
        ><input v-model="model.metadata" type="checkbox" :value="m" />{{
          m
        }}</label
      >
    </fieldset>
    <p class="text-xs text-[#9AA3B2]">
      Float64 values retain their JSON round-trip precision. Exact 64-bit
      integer strings remain strings; implicit numeric narrowing is unavailable.
    </p>
  </div>
</template>
<script setup lang="ts">
interface Mapping {
  format: string
  fields: { from: string; to: string; convert: string; required: boolean }[]
  metadata: string[]
}
const model = defineModel<Mapping>({ required: true })
function add() {
  model.value.fields.push({
    from: '',
    to: '',
    convert: 'identity',
    required: true,
  })
}
</script>

<template>
  <div class="space-y-3 rounded-lg border border-[#2A2F3A] p-3">
    <label class="label" :for="`${uid}-mode`">Match</label>
    <select :id="`${uid}-mode`" v-model="mode" class="input" @change="update">
      <option value="advanced" disabled>Custom nested expression</option>
      <option value="all-events">All telemetry</option>
      <option value="all">All conditions (AND)</option>
      <option value="any">Any condition (OR)</option>
    </select>
    <div v-if="['all', 'any'].includes(mode)" class="space-y-3">
      <div
        v-for="(condition, index) in conditions"
        :key="index"
        class="space-y-2 rounded border border-[#2A2F3A] p-2"
      >
        <label class="label" :for="`${uid}-field-${index}`"
          >Field or metadata</label
        >
        <input
          :id="`${uid}-field-${index}`"
          v-model="condition.field"
          class="input mono"
          placeholder="payload.temperature or device_id"
          @input="update"
        />
        <label class="label" :for="`${uid}-op-${index}`">Operator</label>
        <select
          :id="`${uid}-op-${index}`"
          v-model="condition.op"
          class="input"
          @change="update"
        >
          <option v-for="op in operators" :key="op" :value="op">
            {{ op }}
          </option>
        </select>
        <template v-if="condition.op !== 'exists'"
          ><label class="label" :for="`${uid}-value-${index}`"
            >Value (JSON scalar; quote text / exact large integers)</label
          ><input
            :id="`${uid}-value-${index}`"
            v-model="condition.raw"
            class="input mono"
            placeholder='40 or true or "device UUID"'
            @input="update"
        /></template>
        <button type="button" class="btn-ghost text-xs" @click="remove(index)">
          Remove condition {{ index + 1 }}
        </button>
      </div>
      <button
        type="button"
        class="btn-ghost text-xs"
        :disabled="conditions.length >= 16"
        @click="add"
      >
        Add condition
      </button>
    </div>
    <details>
      <summary class="cursor-pointer text-xs text-[#b79bff]">
        Nested AND/OR expression
      </summary>
      <p class="my-2 text-xs text-[#9AA3B2]">
        Optional JSON rule with all/any groups, at most 64 nodes and five
        levels. Applying replaces the conditions above.
      </p>
      <textarea
        v-model="advanced"
        class="input min-h-28 font-mono text-xs"
        aria-label="Nested routing JSON"
      /><button type="button" class="btn-ghost text-xs" @click="applyAdvanced">
        Apply expression
      </button>
    </details>
    <p v-if="error" role="alert" class="text-xs text-red-300">{{ error }}</p>
    <p class="text-xs text-[#9AA3B2]">
      Fields: payload.field_name, device_id, schema_slot, schema_version,
      event_type, group_ids and labels. Use contains with a group UUID or tag for exact membership. Missing fields fail closed. Numeric thresholds preserve
      decimal strings.
    </p>
  </div>
</template>
<script setup lang="ts">
const model = defineModel<any>({ default: null }),
  uid = useId(),
  mode = ref('all-events'),
  conditions = ref<{ field: string; op: string; raw: string }[]>([]),
  advanced = ref('null'),
  error = ref('')
const operators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists']
function hydrate() {
  advanced.value = JSON.stringify(model.value, null, 2)
  const r = model.value as any
  if (!r) {
    mode.value = 'all-events'
    conditions.value = []
    return
  }
  const rows = r.all || r.any || (r.field ? [r] : [])
  if (rows.every((x: any) => x.field)) {
    mode.value = r.any ? 'any' : 'all'
    conditions.value = rows.map((x: any) => ({
      field: x.field,
      op: x.op,
      raw: JSON.stringify(x.value) ?? '',
    }))
  } else {
    mode.value = 'advanced'
    conditions.value = []
  }
}
hydrate()
function update() {
  try {
    error.value = ''
    model.value =
      mode.value === 'all-events'
        ? null
        : {
            [mode.value]: conditions.value.map((c) => ({
              field: c.field,
              op: c.op,
              ...(c.op === 'exists' ? {} : { value: JSON.parse(c.raw) }),
            })),
          }
    advanced.value = JSON.stringify(model.value, null, 2)
  } catch {
    error.value = 'Use valid JSON scalar values before continuing.'
    model.value = { invalid: true }
  }
}
function add() {
  conditions.value.push({ field: 'payload.temperature', op: 'gt', raw: '40' })
  update()
}
function remove(index: number) {
  conditions.value.splice(index, 1)
  update()
}
function applyAdvanced() {
  try {
    model.value = JSON.parse(advanced.value)
    error.value = ''
    hydrate()
  } catch {
    error.value = 'Invalid JSON expression'
  }
}
</script>

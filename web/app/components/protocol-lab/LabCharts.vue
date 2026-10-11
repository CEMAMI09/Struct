<script setup lang="ts">
import type { LabResponse, LabResult, LabSettings, ProtocolId } from '#shared/protocol-lab/types'
const props = defineProps<{ results: LabResult[]; scaling: LabResponse['scaling']; settings: LabSettings }>()
const emit = defineEmits<{ axis: [LabSettings['scaling']]; inspect: [LabResult, string] }>()
const focus = ref<number | null>(null)
const colors = ['#9a79ff', '#65728a', '#bca8ef', '#527f88', '#959ba7', '#61666f']
const max = computed(() => Math.max(1, ...props.results.map((r) => r.metrics.selected?.value ?? 0)))
function segments(r: LabResult) {
  const total = r.metrics.selected?.value
  if (total === null || total === undefined) return []
  const security = settingsSecurity(r)
  const pieces = [
    { label: 'Encoded data', value: r.parts.payload, color: colors[0] },
    { label: 'Protocol', value: r.parts.framing ?? 0, color: colors[1] },
    { label: 'Security', value: security, color: colors[2] },
  ]
  if (props.settings.boundary === 'network')
    pieces.push({
      label: 'Transport/IP',
      value: (r.parts.transport ?? 0) + (r.parts.network ?? 0),
      color: colors[3],
    })
  if (props.settings.traffic === 'exchange')
    pieces.push({
      label: 'Response',
      value:
        props.settings.boundary === 'network'
          ? (r.metrics.networkDown?.value ?? 0)
          : props.settings.boundary === 'application'
            ? (r.metrics.applicationDown?.value ?? 0)
            : (r.parts.response ?? 0),
      color: colors[4],
    })
  if (r.parts.connection)
    pieces.push({ label: 'Session allocation', value: r.parts.connection, color: colors[5] })
  const sum = pieces.reduce((a, b) => a + b.value, 0)
  if (sum > total)
    return [{ label: 'Selected total (breakdown unavailable)', value: total, color: colors[1] }]
  if (sum < total) pieces.push({ label: 'Other calculated/modeled bytes', value: total - sum, color: colors[5] })
  return pieces.filter((x) => x.value > 0)
}
function settingsSecurity(r: LabResult) { return r.parts.security ?? 0 }

const ymax = computed(() =>
  Math.max(1, ...props.scaling.flatMap((p) => props.results.map((r) => p.values[r.id] ?? 0))),
)
const x = (i: number) => 50 + (i * 580) / Math.max(1, props.scaling.length - 1)
const y = (v: number) => 180 - (v / ymax.value) * 140
function points(id: ProtocolId) {
  return props.scaling.map((p, i) =>
    p.values[id] === null || p.values[id] === undefined ? null : `${x(i)},${y(p.values[id]!)}`,
  )
}
const axisLabel = computed(() =>
  props.settings.scaling === 'batch'
    ? 'Readings per batch'
    : props.settings.scaling === 'fields'
      ? 'Copies of the first schema field'
      : 'Binary input bytes',
)
</script>
<template>
  <div class="lab-chart-grid">
    <section class="lab-panel lab-breakdown">
      <div class="lab-panel-heading">
        <div>
          <p class="lab-eyebrow">BYTE COMPOSITION</p>
          <h2>{{ settings.traffic === 'exchange' ? 'Exchange' : 'Uplink' }} breakdown</h2>
        </div>
      </div>
      <p class="lab-help">Bytes per batch · {{ settings.boundary }} boundary</p>
      <div class="lab-bar-axis">
        <span>0 B</span><span>{{ max.toLocaleString() }} B</span>
      </div>
      <div v-for="r in results" :key="r.id" class="lab-bar-row">
        <div>
          <strong>{{ r.name }}</strong
          ><span>{{
            r.metrics.selected?.value === null
              ? 'Unavailable'
              : `${r.metrics.selected?.value?.toLocaleString()} B`
          }}</span>
        </div>
        <button
          v-if="segments(r).length"
          type="button"
          class="lab-stacked-bar"
          :aria-label="`${r.name} byte breakdown`"
          @click="emit('inspect', r, 'selected')"
        >
          <span
            v-for="(part, index) in segments(r)"
            :key="index"
            :style="{ width: `${(part.value / max) * 100}%`, background: part.color }"
            :title="`${part.label}: ${part.value} bytes`"
          />
        </button>
        <div v-else class="lab-empty-bar">No value at this measurement boundary</div>
      </div>
      <div class="lab-chart-legend">
        <span
          v-for="(label, i) in ['Data', 'Protocol', 'Security', 'Transport/IP', 'Response', 'Other']"
          :key="label"
          ><i :style="{ background: colors[i] }" />{{ label }}</span
        >
      </div>
    </section>
    <section class="lab-panel lab-scaling">
      <div class="lab-panel-heading">
        <div>
          <p class="lab-eyebrow">ENCODED AT EACH POINT</p>
          <h2>Schema &amp; batch scaling</h2>
        </div>
      </div>
      <label class="sr-only" for="lab-axis">Scaling axis</label
      ><select
        id="lab-axis"
        class="lab-input"
        :value="settings.scaling"
        @change="emit('axis', ($event.target as HTMLSelectElement).value as LabSettings['scaling'])"
      >
        <option value="batch">Readings per batch</option>
        <option value="fields">Field count (copies of first field)</option>
        <option value="bytes">Binary input size</option>
      </select>
      <svg
        viewBox="0 0 680 230"
        role="img"
        :aria-label="`Bytes per reading by ${axisLabel}`"
        class="lab-scaling-svg"
      >
        <text x="10" y="20" class="lab-axis-label">Bytes / reading</text>
        <path d="M50 35V180H640" fill="none" stroke="currentColor" opacity=".3" />
        <text x="12" y="45" class="lab-axis-label">{{ Math.ceil(ymax) }}</text>
        <text x="30" y="183" class="lab-axis-label">0</text>
        <g v-for="(r, ri) in results" :key="r.id">
          <template v-for="(point, index) in points(r.id)" :key="index">
            <circle
              v-if="point"
              :cx="x(index)"
              :cy="y(scaling[index]!.values[r.id]!)"
              r="4"
              :fill="colors[ri]"
              tabindex="0"
              :aria-label="`${r.name}, ${scaling[index]!.x}: ${scaling[index]!.values[r.id]} bytes per reading`"
              @focus="focus = index"
              @mouseenter="focus = index"
              @blur="focus = null"
            >
              <title>{{ r.name }}: {{ scaling[index]!.values[r.id] }} B</title>
            </circle>
          </template>
        </g>
        <text
          v-for="(p, index) in scaling"
          :key="p.x"
          :x="x(index)"
          y="199"
          text-anchor="middle"
          class="lab-axis-label"
        >
          {{ p.x }}
        </text>
        <text x="345" y="224" text-anchor="middle" class="lab-axis-label">{{ axisLabel }}</text>
      </svg>
      <div class="lab-chart-legend">
        <span v-for="(r, i) in results" :key="r.id"
          ><i :style="{ background: colors[i] }" />{{ r.name }}</span
        >
      </div>
      <p v-if="focus !== null" class="lab-chart-readout" aria-live="polite">
        {{ axisLabel }} {{ scaling[focus]?.x }}:
        {{
          results.map((r) => `${r.name} ${scaling[focus ?? 0]?.values[r.id] ?? 'unavailable'} B`).join(' · ')
        }}
      </p>
      <p class="lab-help">
        Calculated discrete points, not interpolated measurements. Gaps mean unsupported or unavailable; TLS
        references require an exact match.
      </p>
    </section>
  </div>
</template>

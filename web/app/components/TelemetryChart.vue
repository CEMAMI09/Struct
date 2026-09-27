<template>
  <div class="flex h-full flex-col">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-[#E8EAEF]">Telemetry</h2>
      <div class="flex min-w-0 items-center gap-2">
        <select
          v-if="numericFields.length > 1"
          :value="activeField || ''"
          class="input max-w-[10rem] py-1 font-mono text-[10px]"
          aria-label="Chart field"
          @change="chooseField"
        >
          <option v-for="field in numericFields" :key="field" :value="field">
            {{ field }}
          </option>
        </select>
        <span
          v-else
          class="truncate font-mono text-[10px] text-[#8B93A7]"
        >{{ fieldLabel }}</span>
      </div>
    </div>

    <ClientOnly>
      <VChart
        v-if="hasData"
        ref="chartEl"
        class="min-h-0 flex-1"
        :option="chartOption"
      />
      <template #fallback>
        <div class="flex flex-1 items-center justify-center text-sm text-[#8B93A7]">
          Loading chart…
        </div>
      </template>
    </ClientOnly>

    <div
      v-if="!hasData"
      class="flex flex-1 items-center justify-center px-4 text-center text-sm text-[#9AA3B2]"
    >
      No events received yet. The chart appears after a numeric field is stored.
    </div>
    <p v-else class="mt-2 text-xs text-[#9AA3B2]">
      Points are stored samples. The line only joins those samples. No unit is shown unless the field name includes one.
    </p>
    <details v-if="hasData" class="mt-2 text-xs text-[#C5CAD3]">
      <summary class="cursor-pointer rounded py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b79bff]">View telemetry as a table</summary>
      <div class="mt-2 max-h-56 overflow-auto rounded-xl border border-white/10">
        <table class="w-full text-left">
          <caption class="sr-only">Stored samples for {{ fieldLabel }}</caption>
          <thead class="sticky top-0 bg-[#101012]">
            <tr><th scope="col" class="px-3 py-2">Stored at</th><th scope="col" class="px-3 py-2">{{ fieldLabel }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" class="border-t border-white/10">
              <td class="px-3 py-2">{{ formatSampleTime(row.timestamp) }}</td>
              <td class="px-3 py-2 font-mono">{{ sampleValue(row) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { graphic, use, type EChartsCoreOption } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import type { TelemetryRow } from '~/types'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent])

const FIELD_KEY = 'struct-telemetry-field'

const props = defineProps<{
  rows: TelemetryRow[]
  field?: string | null
}>()

const { mode } = useTheme()
const chartInk = computed(() =>
  mode.value === 'light'
    ? {
        tooltipBg: '#ffffff',
        tooltipBorder: 'rgba(20, 22, 28, 0.12)',
        text: '#14161c',
        muted: '#5c6575',
      }
    : {
        tooltipBg: '#101012',
        tooltipBorder: 'rgba(255, 255, 255, 0.08)',
        text: '#E8EAEF',
        muted: '#8B93A7',
      },
)

const selectedField = ref<string | null>(null)
const savedField = ref<string | null>(readSavedField())
const chartEl = ref<{ $el?: HTMLElement, resize: (opts?: { animation?: { duration?: number } }) => void } | null>(null)
let resizeObserver: ResizeObserver | undefined

watch(chartEl, (chart) => {
  resizeObserver?.disconnect()
  const node = chart?.$el
  if (!node || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    chart.resize({ animation: { duration: 0 } })
  })
  resizeObserver.observe(node)
})

onUnmounted(() => resizeObserver?.disconnect())

const numericFields = computed(() => {
  const keys = new Set<string>()
  for (const row of props.rows) {
    for (const [k, v] of Object.entries(row.parsed_json || {})) {
      if (typeof v === 'number') keys.add(k)
    }
  }
  return [...keys]
})

function readSavedField() {
  if (!import.meta.client) return null
  try {
    return localStorage.getItem(FIELD_KEY) || null
  } catch {
    return null
  }
}

function chooseField(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (!value || !numericFields.value.includes(value)) return
  selectedField.value = value
  savedField.value = value
  try {
    localStorage.setItem(FIELD_KEY, value)
  } catch {
    /* ignore quota or private mode */
  }
}

function applyField(fields: string[]) {
  if (props.field && fields.includes(props.field)) {
    selectedField.value = props.field
    return
  }
  if (savedField.value && fields.includes(savedField.value)) {
    selectedField.value = savedField.value
    return
  }
  if (selectedField.value && fields.includes(selectedField.value)) return
  selectedField.value = fields[0] || null
}

onMounted(() => {
  savedField.value = readSavedField()
  applyField(numericFields.value)
})

watch(numericFields, (fields) => applyField(fields), { immediate: true })

const activeField = computed(() => {
  if (props.field && numericFields.value.includes(props.field)) return props.field
  if (selectedField.value && numericFields.value.includes(selectedField.value)) {
    return selectedField.value
  }
  return numericFields.value[0] || null
})

const fieldLabel = computed(() => activeField.value || '—')

const hasData = computed(() => props.rows.length > 0 && !!activeField.value)

function formatSampleTime(value: string) {
  return new Date(value).toLocaleString([], { timeZoneName: 'short' })
}

function sampleValue(row: TelemetryRow) {
  const value = activeField.value ? row.parsed_json?.[activeField.value] : null
  return typeof value === 'number' ? String(value) : '—'
}

const chartOption = computed<EChartsCoreOption>(() => {
  const field = activeField.value
  if (!field) return {}

  const times = props.rows.map((r) =>
    new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  )
  const values = props.rows.map((r) => {
    const v = r.parsed_json?.[field]
    return typeof v === 'number' ? v : null
  })

  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: 500,
    animationEasingUpdate: 'cubicOut',
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartInk.value.tooltipBg,
      borderColor: chartInk.value.tooltipBorder,
      textStyle: { color: chartInk.value.text, fontFamily: 'Geist Mono, ui-monospace, monospace', fontSize: 11 },
      formatter: (params: unknown) => {
        const point = (Array.isArray(params) ? params[0] : params) as {
          dataIndex?: number
          data?: number | null
        }
        const row = typeof point.dataIndex === 'number' ? props.rows[point.dataIndex] : undefined
        const when = row
          ? new Date(row.timestamp).toLocaleString([], { timeZoneName: 'short' })
          : ''
        const value = point.data ?? '—'
        return `${when}<br/>${field}: ${value}`
      },
    },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: chartInk.value.muted, fontSize: 10, fontFamily: 'Figtree, ui-sans-serif, sans-serif' },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: chartInk.value.muted, fontSize: 10, fontFamily: 'Figtree, ui-sans-serif, sans-serif' },
    },
    series: [
      {
        id: 'telemetry',
        name: field,
        type: 'line',
        animationDurationUpdate: 500,
        animationEasingUpdate: 'cubicOut',
        smooth: true,
        connectNulls: false,
        showSymbol: false,
        data: values,
        lineStyle: { color: '#8b6cff', width: 2 },
        itemStyle: { color: '#8b6cff' },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(139, 108, 255, 0.36)' },
            { offset: 1, color: 'rgba(139, 108, 255, 0)' },
          ]),
        },
      },
    ],
  }
})
</script>

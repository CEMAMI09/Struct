<template>
  <div class="flex h-full flex-col">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-[#E8EAEF]">Telemetry</h2>
      <div class="flex min-w-0 items-center gap-2">
        <select
          v-if="numericFields.length > 1"
          v-model="selectedField"
          class="input max-w-[10rem] py-1 font-mono text-[10px]"
          aria-label="Chart field"
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
      <VChart v-if="hasData" class="min-h-0 flex-1" :option="chartOption" autoresize />
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
  </div>
</template>

<script setup lang="ts">
import { use } from 'echarts/core'
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

const props = defineProps<{
  rows: TelemetryRow[]
  field?: string | null
}>()

const selectedField = ref<string | null>(null)

const numericFields = computed(() => {
  const keys = new Set<string>()
  for (const row of props.rows) {
    for (const [k, v] of Object.entries(row.parsed_json || {})) {
      if (typeof v === 'number') keys.add(k)
    }
  }
  return [...keys]
})

watch(
  numericFields,
  (fields) => {
    if (props.field && fields.includes(props.field)) {
      selectedField.value = props.field
      return
    }
    if (selectedField.value && fields.includes(selectedField.value)) return
    selectedField.value = fields[0] || null
  },
  { immediate: true },
)

const activeField = computed(() => {
  if (props.field && numericFields.value.includes(props.field)) return props.field
  if (selectedField.value && numericFields.value.includes(selectedField.value)) {
    return selectedField.value
  }
  return numericFields.value[0] || null
})

const fieldLabel = computed(() => activeField.value || '—')

const hasData = computed(() => props.rows.length > 0 && !!activeField.value)

const chartOption = computed(() => {
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
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#14161c',
      borderColor: '#252830',
      textStyle: { color: '#E8EAEF', fontFamily: 'Geist Mono, ui-monospace, monospace', fontSize: 11 },
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
      axisLine: { lineStyle: { color: '#252830' } },
      axisLabel: { color: '#8B93A7', fontSize: 10, fontFamily: 'Geist, ui-sans-serif, sans-serif' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#252830', type: 'dashed' } },
      axisLabel: { color: '#8B93A7', fontSize: 10, fontFamily: 'Geist, ui-sans-serif, sans-serif' },
    },
    series: [
      {
        name: field,
        type: 'line',
        smooth: false,
        connectNulls: false,
        showSymbol: true,
        symbolSize: 6,
        data: values,
        lineStyle: { color: '#38B6FF', width: 2 },
        itemStyle: { color: '#38B6FF' },
      },
    ],
  }
})
</script>

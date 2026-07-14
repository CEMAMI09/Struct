<template>
  <div class="flex h-full flex-col">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-[#E8EAEF]">Telemetry</h2>
      <div class="flex items-center gap-2">
        <span
          v-if="live"
          class="flex items-center gap-1.5 font-mono text-[10px] text-[#00FFA3]"
        >
          <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00FFA3]" />
          LIVE
        </span>
        <span class="font-mono text-[10px] text-[#8B93A7]">{{ fieldLabel }}</span>
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
      class="flex flex-1 items-center justify-center text-sm text-[#8B93A7]"
    >
      Waiting for packets…
    </div>
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
  live?: boolean
  field?: string | null
}>()

const numericFields = computed(() => {
  const keys = new Set<string>()
  for (const row of props.rows) {
    for (const [k, v] of Object.entries(row.parsed_json || {})) {
      if (typeof v === 'number') keys.add(k)
    }
  }
  return [...keys]
})

const activeField = computed(() => {
  if (props.field && numericFields.value.includes(props.field)) return props.field
  return numericFields.value[0] || null
})

const fieldLabel = computed(() => activeField.value || '—')

const hasData = computed(() => props.rows.length > 0 && !!activeField.value)

const chartOption = computed(() => {
  const field = activeField.value
  if (!field) return {}

  const times = props.rows.map((r) => {
    const d = new Date(r.timestamp)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  })
  const values = props.rows.map((r) => {
    const v = r.parsed_json?.[field]
    return typeof v === 'number' ? v : null
  })

  return {
    backgroundColor: 'transparent',
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1A1D24',
      borderColor: '#2A2F3A',
      textStyle: { color: '#E8EAEF', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: '#2A2F3A' } },
      axisLabel: { color: '#8B93A7', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#2A2F3A', type: 'dashed' } },
      axisLabel: { color: '#8B93A7', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
    },
    series: [
      {
        name: field,
        type: 'line',
        smooth: true,
        showSymbol: props.rows.length < 20,
        symbolSize: 6,
        data: values,
        lineStyle: { color: '#00FFA3', width: 2 },
        itemStyle: { color: '#00FFA3' },
      },
    ],
  }
})
</script>

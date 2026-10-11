<script setup lang="ts">
import type { LabResult, RoiInput } from '#shared/protocol-lab/types'
import { calculateRoi } from '#shared/protocol-lab/roi'
const props = defineProps<{ input: RoiInput; results: LabResult[] }>()
const period = ref<'monthly' | 'annual'>('annual')
const calculation = computed(() => {
  try {
    return { rows: calculateRoi(props.input, props.results), error: '' }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Invalid ROI inputs.' }
  }
})
const money = (v: number | null) =>
  v === null
    ? '—'
    : new Intl.NumberFormat('en', {
        style: 'currency',
        currency: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(props.input.currency)
          ? props.input.currency
          : 'USD',
        maximumFractionDigits: 2,
      }).format(v)
</script>
<template>
  <section v-if="input.enabled" class="lab-panel lab-roi" aria-labelledby="roi-heading">
    <div class="lab-panel-heading">
      <div>
        <p class="lab-eyebrow">YOUR FLEET · MODELED SCENARIO</p>
        <h2 id="roi-heading">Connectivity cost &amp; traffic</h2>
      </div>
      <label class="lab-label"
        >Period<select v-model="period" class="lab-input">
          <option value="annual">Annual</option>
          <option value="monthly">Monthly</option>
        </select></label
      >
    </div>
    <p class="lab-help">
      {{ input.devices.toLocaleString() }} devices × {{ input.eventsPerDay.toLocaleString() }} events/day ×
      {{ input.daysPerYear }} days/year × {{ input.cellularPercent }}% cellular. Decimal MB; monthly values
      are annual totals ÷ 12.
    </p>
    <p v-if="calculation.error" role="alert" class="lab-error">{{ calculation.error }}</p>
    <div class="lab-table-scroll" tabindex="0">
      <table class="lab-table">
        <thead>
          <tr>
            <th scope="col">Protocol</th>
            <th scope="col">Network B / event</th>
            <th scope="col">{{ period }} MB</th>
            <th scope="col">Current {{ period }} MB</th>
            <th scope="col">Traffic saved</th>
            <th scope="col">{{ period }} cost</th>
            <th scope="col">{{ period }} savings</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in calculation.rows" :key="row.id">
            <th scope="row">{{ row.id }}</th>
            <td>{{ row.bytesPerEvent?.toFixed(2) ?? '—' }}</td>
            <td>
              {{
                (period === 'annual' ? row.annualMB : row.monthlyMB)?.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                }) ?? '—'
              }}
            </td>
            <td>
              {{
                (row.currentAnnualMB === null
                  ? null
                  : row.currentAnnualMB / (period === 'annual' ? 1 : 12)
                )?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'
              }}
            </td>
            <td>
              {{ row.reduction === null ? '—' : `${row.reduction.toFixed(2)}%`
              }}<small>{{
                row.annualSavedMB === null
                  ? 'Not comparable'
                  : `${(row.annualSavedMB / (period === 'annual' ? 1 : 12)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`
              }}</small>
            </td>
            <td>{{ money(period === 'annual' ? row.annualCost : row.monthlyCost) }}</td>
            <td>
              {{
                money(row.annualSavings === null ? null : row.annualSavings / (period === 'annual' ? 1 : 12))
              }}<small>{{ row.note }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="lab-table-footnote">
      Full network estimates only. Missing TCP/IP traffic cannot produce a financial result. Explicit measured
      baseline inputs are user assumptions, not equivalent-security claims. Flat-rate bills do not fall
      automatically. Lifecycle costs, unmeasured retries, carrier session rounding, and Struct subscription
      fees are excluded.
    </p>
  </section>
</template>

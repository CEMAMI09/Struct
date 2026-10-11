<script setup lang="ts">
import type { LabResult, LabSettings } from '#shared/protocol-lab/types'
defineProps<{ results: LabResult[]; settings: LabSettings; pending: boolean }>()
const emit = defineEmits<{ inspect: [LabResult, string] }>()
const rows = [
  ['payload', 'Encoded batch data'],
  ['framing', 'Uplink protocol framing'],
  ['security', 'Uplink security overhead'],
  ['transport', 'Uplink transport headers'],
  ['network', 'Uplink IP headers'],
  ['applicationUp', 'Application uplink'],
  ['applicationDown', 'Application downlink'],
  ['networkUp', 'Total network uplink'],
  ['networkDown', 'Total network downlink'],
  ['setup', 'Connection setup reference'],
  ['stream', 'Selected TCP/TLS stream'],
  ['exchange', 'Network exchange'],
  ['effective', 'Selected bytes / reading'],
] as const
const bytes = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(v) + ' B'
const signed = (v: number | null) =>
  v === null ? 'Not comparable' : v === 0 ? '0.00%' : `${Math.abs(v).toFixed(2)}% ${v > 0 ? 'less' : 'more'}`
const securityRows = [
  ['encryption', 'Encryption'],
  ['authentication', 'Authentication'],
  ['integrity', 'Integrity'],
  ['replay', 'Replay protection'],
  ['forwardSecrecy', 'Forward secrecy'],
  ['keys', 'Key management'],
] as const
const reliabilityRows = [
  ['guarantee', 'Acknowledgment guarantee'],
  ['retries', 'Retries'],
  ['deduplication', 'Deduplication'],
] as const
function isMinimum(result: LabResult, results: LabResult[]) {
  const group = results.filter(
    (r) => r.eligibilityKey === result.eligibilityKey && r.metrics.effective?.value !== null,
  )
  return (
    group.length > 1 &&
    result.metrics.effective?.value !== null &&
    result.metrics.effective?.value === Math.min(...group.map((r) => r.metrics.effective!.value!))
  )
}
</script>
<template>
  <section class="lab-comparison" aria-labelledby="comparison-heading" :aria-busy="pending">
    <div class="lab-panel-heading">
      <div>
        <p class="lab-eyebrow">LIVE COMPARISON</p>
        <h2 id="comparison-heading">Every byte, accounted for.</h2>
      </div>
      <span class="lab-status" :class="{ updating: pending }">{{
        pending
          ? 'Recalculating…'
          : settings.boundary === 'network'
            ? 'UDP/IP estimate'
            : settings.boundary === 'stream'
              ? 'TCP/TLS stream'
              : 'Application bytes'
      }}</span>
    </div>
    <div class="lab-table-scroll" tabindex="0" aria-label="Protocol comparison, scroll horizontally">
      <table class="lab-table">
        <thead>
          <tr>
            <th scope="col" class="lab-row-label">
              {{ settings.traffic === 'exchange' ? 'Full exchange' : 'Uplink only'
              }}<small>{{ settings.batch }} reading{{ settings.batch === 1 ? '' : 's' }} / batch</small>
            </th>
            <th
              v-for="result in results"
              :key="result.id"
              scope="col"
              :class="{ 'lab-struct-column': result.id === 'struct' }"
            >
              <div class="lab-protocol-title">
                <span>{{ result.name }}</span
                ><span v-if="result.id === 'struct'" class="lab-own">STRUCT</span>
              </div>
              <small>{{ result.profile || result.reason }}</small
              ><button class="lab-evidence" type="button" @click="emit('inspect', result, 'selected')">
                {{
                  result.status === 'unsupported' || result.status === 'not_tested'
                    ? result.status.replace('_', ' ')
                    : result.metrics.selected?.evidence.replace('_', ' ')
                }}
                <span aria-hidden="true">↗</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[key, label] in rows" :key="key" :class="{ 'lab-primary-row': key === 'effective' }">
            <th scope="row" class="lab-row-label">{{ label }}</th>
            <td
              v-for="result in results"
              :key="result.id"
              :class="{
                'lab-struct-column': result.id === 'struct',
                'lab-smallest': key === 'effective' && isMinimum(result, results),
              }"
            >
              <div class="lab-metric">
                <span :data-testid="`${result.id}-${key}`">{{ bytes(result.metrics[key]?.value) }}</span
                ><button
                  type="button"
                  class="lab-info"
                  :aria-label="`${result.name}: explain ${label}`"
                  @click="emit('inspect', result, key)"
                >
                  i
                </button>
              </div>
              <small
                v-if="key === 'effective' && result.metrics.effective?.value === null"
                class="lab-missing"
                >{{ result.reason || 'Unavailable at this boundary' }}</small
              >
            </td>
          </tr>
          <tr>
            <th scope="row" class="lab-row-label">Difference vs {{ settings.baseline }}</th>
            <td
              v-for="result in results"
              :key="result.id"
              :class="{ 'lab-struct-column': result.id === 'struct' }"
            >
              {{
                result.difference === null
                  ? 'Not comparable'
                  : result.difference === 0
                    ? '0 B'
                    : `${bytes(Math.abs(result.difference))} ${result.difference > 0 ? 'less' : 'more'}`
              }}
            </td>
          </tr>
          <tr>
            <th scope="row" class="lab-row-label">Reduction vs {{ settings.baseline }}</th>
            <td
              v-for="result in results"
              :key="result.id"
              :class="{ 'lab-struct-column': result.id === 'struct' }"
            >
              <span :class="{ 'lab-muted': result.reduction === null }">{{ signed(result.reduction) }}</span
              ><small v-if="result.reduction === null">{{ result.notComparable[0] }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="lab-table-footnote">
      — means unavailable, never zero. Minimum highlighting applies only within a matching comparison group.
      Header info opens methodology, sources and exact configuration.
    </p>
    <details class="lab-table-group">
      <summary>Security specifications <span>No numerical scores</span></summary>
      <div class="lab-table-scroll" tabindex="0">
        <table class="lab-table">
          <thead>
            <tr>
              <th scope="col">Security property</th>
              <th v-for="r in results" :key="r.id" scope="col">{{ r.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="[key, label] in securityRows" :key="key">
              <th scope="row">{{ label }}</th>
              <td v-for="r in results" :key="r.id">{{ r.security[key] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
    <details class="lab-table-group">
      <summary>
        Delivery &amp; reliability <span>Different acknowledgments mean different guarantees</span>
      </summary>
      <div class="lab-table-scroll" tabindex="0">
        <table class="lab-table">
          <thead>
            <tr>
              <th scope="col">Delivery property</th>
              <th v-for="r in results" :key="r.id" scope="col">{{ r.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="[key, label] in reliabilityRows" :key="key">
              <th scope="row">{{ label }}</th>
              <td v-for="r in results" :key="r.id">
                {{ r.reliability[key] || 'Not tested for this configuration' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
import type { LabConfig, LabMetadata, LabResult } from '#shared/protocol-lab/types'
const props = defineProps<{
  result: LabResult | null
  metric: string
  config: LabConfig
  metadata: LabMetadata | null
}>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
watch(
  () => props.result,
  async (value) => {
    await nextTick()
    if (value && !dialog.value?.open) dialog.value?.showModal()
    if (!value && dialog.value?.open) dialog.value.close()
  },
)
const sources = computed(
  () => props.metadata?.sources.filter((s) => props.result?.sources.includes(s.id)) ?? [],
)
const readable = (value: unknown) => JSON.stringify(value, null, 2)
</script>
<template>
  <dialog
    ref="dialog"
    class="lab-dialog"
    aria-labelledby="explanation-title"
    @close="emit('close')"
    @click="$event.target === dialog && dialog?.close()"
  >
    <template v-if="result">
      <div class="lab-dialog-heading">
        <div>
          <p class="lab-eyebrow">RESULT EVIDENCE</p>
          <h2 id="explanation-title">{{ result.name }} · {{ metric }}</h2>
        </div>
        <button
          type="button"
          class="lab-button"
          autofocus
          aria-label="Close explanation"
          @click="dialog?.close()"
        >
          Close ×
        </button>
      </div>
      <p class="lab-explanation-profile">{{ result.profile }}</p>
      <div class="lab-explanation-number">
        {{ result.metrics[metric]?.value ?? 'Unavailable'
        }}<span v-if="result.metrics[metric]?.value !== null && result.metrics[metric]?.value !== undefined">
          bytes</span
        ><span class="lab-evidence">{{ result.metrics[metric]?.evidence || result.status }}</span>
      </div>
      <p>
        {{
          result.metrics[metric]?.note ||
          result.reason ||
          'No independently instrumented value for this metric.'
        }}
      </p>
      <p v-if="result.reason" class="lab-error">{{ result.reason }}</p>
      <dl class="lab-detail-list">
        <dt>Implementation</dt>
        <dd>{{ result.implementation || 'No supported implementation for these settings' }}</dd>
        <dt>Measurement boundary</dt>
        <dd>{{ result.boundary }} · {{ config.settings.traffic }}</dd>
        <dt>Guarantee</dt>
        <dd>{{ result.reliability.guarantee }}</dd>
        <dt>Comparison status</dt>
        <dd>
          {{
            result.notComparable.join(' ') ||
            'Same data and measurement boundary; inspect security and delivery dimensions independently.'
          }}
        </dd>
      </dl>
      <dl v-if="result.comparison" class="lab-detail-list"><dt>Data</dt><dd>{{result.comparison.data}}</dd><dt>Security</dt><dd>{{result.comparison.security}}</dd><dt>Delivery</dt><dd>{{result.comparison.delivery}}</dd><dt>Measurement</dt><dd>{{result.comparison.measurement}}</dd></dl>
      <h3>Byte accounting</h3>
      <dl class="lab-byte-list">
        <template v-for="(value, key) in result.parts" :key="key"
          ><dt>{{ key }}</dt>
          <dd>{{ value === null ? 'Unknown' : `${value} B` }}</dd></template
        >
      </dl>
      <p class="lab-help">
        Parts describe the selected uplink and documented response policy. Network headers are
        specification-calculated. Unknown portions are never counted as zero.
      </p>
      <details v-if="result.payloadHex">
        <summary>Actual encoded sensor/batch bytes</summary>
        <pre class="lab-code">{{ result.payloadHex }}</pre>
        <h3>Decoded semantic values</h3>
        <pre class="lab-code">{{ readable(result.decoded) }}</pre>
      </details>
      <details>
        <summary>Selected schema and settings</summary>
        <pre class="lab-code">{{ readable(config) }}</pre>
      </details>
      <h3>Methodology &amp; limitations</h3>
      <ul>
        <li v-for="note in result.notes" :key="note">{{ note }}</li>
      </ul>
      <h3>Benchmark references</h3>
      <p v-if="!result.references.length">
        Calculated custom configuration. No identical measured record is claimed.
      </p>
      <a
        v-for="id in result.references"
        :key="id"
        :href="`/api/protocol-lab/references?id=${id}`"
        target="_blank"
        rel="noopener noreferrer"
        class="lab-record-link"
        >{{ id }} ↗</a
      >
      <h3>Primary sources</h3>
      <ul>
        <li v-for="source in sources" :key="source.id">
          <a :href="source.url" target="_blank" rel="noopener noreferrer"
            >{{ source.title || source.id }} ↗</a
          >
        </li>
      </ul>
      <a
        :href="`${metadata?.researchUrl}/reports/CALCULATION-RULES.md`"
        target="_blank"
        rel="noopener noreferrer"
        >Full calculation rules and measurement boundaries ↗</a
      >
    </template>
  </dialog>
</template>

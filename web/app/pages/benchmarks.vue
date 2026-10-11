<script setup lang="ts">
import {
  defaultRoi,
  defaults,
  protocolNames,
  presetFields,
  restoreConfig,
  shareConfig,
} from '#shared/protocol-lab/config'
import type {
  LabConfig,
  LabMetadata,
  LabResponse,
  LabResult,
  ProtocolId,
  ResearchSchema,
} from '#shared/protocol-lab/types'
import { calculateRoi } from '#shared/protocol-lab/roi'
definePageMeta({ layout: 'protocol-lab' })
useSeoMeta({
  title: 'Struct Protocol Lab — Interactive IoT benchmark & ROI calculator',
  description:
    'Encode your own telemetry schema. Inspect measured and calculated Struct, Protobuf, CoAP, LwM2M, JSON and CBOR traffic, security, delivery and connectivity costs.',
})
const config = ref<LabConfig>(defaults()),
  roi = ref(structuredClone(defaultRoi)),
  response = ref<LabResponse | null>(null),
  displayConfig = ref<LabConfig>(defaults())
const metadata = ref<LabMetadata | null>(null),
  dataError = ref(''),
  error = ref(''),
  pending = ref(true),
  settingsOpen = ref(false),
  shareMessage = ref(''),
  shareUrl = ref('')
const resultsView = ref<'simple'|'advanced'>('simple')
const inspected = ref<LabResult | null>(null),
  inspectedMetric = ref('selected')
let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined
const visibleResults = computed(
  () => response.value?.results.filter((r) => config.value.settings.visible.includes(r.id)) ?? [],
)
const structResult = computed(() => response.value?.results.find((r) => r.id === 'struct'))
const primary = computed(() => (error.value ? null : (structResult.value?.metrics.effective?.value ?? null)))
const format = (value: number | null) =>
  value === null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)
async function update() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  pending.value = true
  error.value = ''
  const snapshot = JSON.parse(JSON.stringify(config.value)) as LabConfig
  try {
    const next = await $fetch<LabResponse>('/api/protocol-lab/calculate', {
      method: 'POST',
      body: snapshot,
      signal: current.signal,
    })
    if (controller === current) {
      response.value = next
      displayConfig.value = snapshot
    }
  } catch (e) {
    if (!current.signal.aborted) {
      const failure = e as { data?: { message?: string }; message?: string }
      error.value = failure.data?.message || 'The calculation could not be completed. Please retry.'
    }
  } finally {
    if (controller === current) pending.value = false
  }
}
watch(
  config,
  () => {
    clearTimeout(timer)
    pending.value = true
    timer = setTimeout(update, 300)
  },
  { deep: true },
)
async function loadMetadata() {
  try {
    metadata.value = await $fetch<LabMetadata>('/protocol-lab/metadata.json')
    dataError.value = ''
  } catch {
    dataError.value = 'Benchmark metadata could not load. The dataset may be temporarily unavailable.'
  }
}
onMounted(async () => {
  if (window.location.hash.startsWith('#lab=')) {
    try {
      config.value = restoreConfig(window.location.hash.slice(5))
    } catch (e) {
      shareMessage.value =
        'Shared configuration could not be restored. Defaults loaded. ' +
        (e instanceof Error ? e.message : 'Invalid share URL.')
    }
  }
  await loadMetadata()
  await update()
})
onUnmounted(() => {
  clearTimeout(timer)
  controller?.abort()
})
function reset() {
  config.value = defaults()
  roi.value = structuredClone(defaultRoi)
  shareMessage.value = ''
  shareUrl.value = ''
}
function preset(schema: ResearchSchema) {
  if (!schema) return
  config.value.fields = presetFields(schema)
  if (schema.precision_policy !== 'lossless') config.value.settings.precision = 'optimized'
}
function toggleProtocol(id: ProtocolId) {
  const visible = config.value.settings.visible
  if (visible.includes(id)) {
    if (visible.length > 1) config.value.settings.visible = visible.filter((x) => x !== id)
  } else config.value.settings.visible.push(id)
}
function inspect(result: LabResult, metric: string) {
  inspectedMetric.value = metric
  inspected.value = result
}
async function share() {
  try {
    shareUrl.value = window.location.origin + '/benchmarks#lab=' + shareConfig(config.value)
    await navigator.clipboard.writeText(shareUrl.value)
    shareMessage.value = 'Configuration link copied. Sample values are included; pricing is not.'
  } catch (e) {
    shareMessage.value = shareUrl.value
      ? 'Copy the configuration URL below.'
      : e instanceof Error
        ? e.message
        : 'Could not create a share URL.'
  }
}
function download(format: 'json' | 'csv') {
  if (!response.value || pending.value || error.value) return
  let roiResults
  try {
    roiResults = roi.value.enabled ? calculateRoi(roi.value, visibleResults.value) : null
  } catch {
    roiResults = { error: 'Invalid ROI inputs; technical comparison is still valid.' }
  }
  const exportData = {
    datasetVersion: metadata.value?.version,
    configuration: displayConfig.value,
    results: visibleResults.value,
    warnings: response.value.warnings,
    roiScenario: roi.value.enabled ? roi.value : null,
    roiResults,
  }
  let text = JSON.stringify(exportData, null, 2),
    mime = 'application/json'
  if (format === 'csv') {
    const quote = (v: unknown) => {
      const value = typeof v === 'string' ? v : JSON.stringify(v)
      return '"' + String(value ?? '').replace(/"/g, '""') + '"'
    }
    const rows = [
      [
        'protocol',
        'profile',
        'status',
        'boundary',
        'metric',
        'bytes',
        'evidence',
        'methodology',
        'references',
        'warnings',
        'schema',
        'settings',
      ],
    ]
    for (const r of visibleResults.value)
      for (const [key, metric] of Object.entries(r.metrics))
        rows.push([
          r.name,
          r.profile,
          r.status,
          r.boundary,
          key,
          metric.value === null ? '' : String(metric.value),
          metric.evidence,
          metric.note,
          JSON.stringify(r.references),
          JSON.stringify([...r.notes, ...r.notComparable]),
          JSON.stringify(displayConfig.value.fields),
          JSON.stringify(displayConfig.value.settings),
        ])
    text = rows.map((row) => row.map(quote).join(',')).join('\r\n')
    mime = 'text/csv'
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime })),
    anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `struct-protocol-lab.${format}`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>
<template>
  <div class="protocol-lab">
    <header class="lab-page-heading">
      <div>
        <p class="lab-eyebrow">STRUCT RESEARCH / PROTOCOL LAB</p>
        <h1>Your data. Every protocol.<br /><span>See what actually travels.</span></h1>
        <p>
          Build a telemetry schema. Explore its encoding, security and delivery costs.<br
            class="lab-desktop-break"
          />
          Measured evidence and transparent calculations, with no missing bytes disguised as savings.
        </p>
      </div>
      <div class="lab-research-stamp">
        <strong>{{ metadata?.coverage.total_configurations.toLocaleString() ?? 'Loading…' }}</strong
        ><span>reference configurations</span
        ><small>Dataset {{ metadata?.version ?? '1.0.0' }} · local host research</small
        ><a
          v-if="metadata"
          :href="`${metadata.researchUrl}/reports/FINAL-REPORT.md`"
          target="_blank"
          rel="noopener noreferrer"
          >Read the methodology ↗</a
        >
      </div>
    </header>
    <div class="lab-toolbar">
      <button
        type="button"
        class="lab-button lab-mobile-settings"
        :aria-expanded="settingsOpen"
        aria-controls="lab-settings"
        @click="settingsOpen = !settingsOpen"
      >
        {{ settingsOpen ? 'Hide settings' : 'Edit schema & settings' }}
      </button>
      <div class="lab-protocol-switches" aria-label="Visible protocols">
        <button
          v-for="(name, id) in protocolNames"
          :key="id"
          type="button"
          :aria-pressed="config.settings.visible.includes(id)"
          :class="{ active: config.settings.visible.includes(id) }"
          @click="toggleProtocol(id)"
        >
          {{ name }}
        </button>
      </div>
      <div class="lab-actions">
        <button type="button" class="lab-button" @click="share">Share</button
        ><button
          type="button"
          class="lab-button"
          :disabled="pending || !response || !!error"
          @click="download('json')"
        >
          JSON ↓</button
        ><button
          type="button"
          class="lab-button"
          :disabled="pending || !response || !!error"
          @click="download('csv')"
        >
          CSV ↓
        </button>
      </div>
    </div>
    <p v-if="shareMessage" class="lab-notice" role="status">{{ shareMessage }}</p>
    <input
      v-if="shareUrl"
      class="lab-input lab-share-url"
      :value="shareUrl"
      readonly
      aria-label="Shareable configuration URL"
    />
    <div class="lab-workbench">
      <div id="lab-settings" class="lab-settings-wrap" :class="{ open: settingsOpen }">
        <ProtocolLabSidebar
          v-model="config"
          v-model:roi="roi"
          :metadata="metadata"
          @reset="reset"
          @preset="preset"
        />
      </div>
      <div class="lab-dashboard">
        <div v-if="dataError" role="alert" class="lab-error-panel">
          {{ dataError }}
          <button type="button" class="lab-button" @click="loadMetadata">Reload dataset</button>
        </div>
        <div v-if="error" role="alert" class="lab-error-panel">
          <strong>Check your experiment</strong>
          <p>{{ error }}</p>
          <button type="button" class="lab-button" @click="update">Retry calculation</button>
        </div>
        <div class="lab-headline">
          <div>
            <p class="lab-eyebrow">
              STRUCT · {{ displayConfig.settings.traffic === 'exchange' ? 'FULL EXCHANGE' : 'UPLINK' }}
            </p>
            <strong :class="{ 'lab-updating': pending }"
              >{{ format(primary) }}<span v-if="primary !== null"> B</span></strong
            >
            <p>per logical reading · {{ displayConfig.settings.boundary }} boundary</p>
          </div>
          <div class="lab-headline-context">
            <strong>Compare the whole stack.</strong>
            <p>
              Compare the same measurement boundary. Security, precision, delivery and network-model assumptions are explained with each result.
            </p>
          </div>
        </div>
        <div class="lab-baseline">
          <label
            >Comparison baseline<select
              v-model="config.settings.baseline"
              class="lab-input"
              aria-label="Comparison baseline"
            >
              <option v-for="(name, id) in protocolNames" :key="id" :value="id">{{ name }}</option>
            </select></label
          >
          <p>Size differences use the same data and measurement boundary. Security and delivery differences are disclosed; modeled network totals are scenario estimates.</p>
          <span v-if="pending" role="status" class="lab-updating-text">Updating results…</span>
        </div>
        <div v-if="response?.warnings.length" class="lab-warning" aria-live="polite">
          <p v-for="warning in response.warnings" :key="warning">{{ warning }}</p>
        </div>
        <template v-if="response && !error">
          <ProtocolLabComparison
            v-model:view="resultsView"
            :results="visibleResults"
            :settings="displayConfig.settings"
            :pending="pending"
            @inspect="inspect"
          />
          <ProtocolLabCharts
            :results="visibleResults"
            :scaling="response.scaling"
            :settings="displayConfig.settings"
            @axis="config.settings.scaling = $event"
            @inspect="inspect"
          />
          <ProtocolLabRoi :input="roi" :results="visibleResults" />
          <ProtocolLabIntegration :result="structResult" :settings="displayConfig.settings" />
        </template>
        <div v-else-if="pending && !error" class="lab-loading" role="status">
          Loading encoders and benchmark references…
        </div>
        <ProtocolLabResearchExplorer />
        <footer class="lab-methodology-note">
          <strong>Measurement boundaries matter.</strong>
          <p>
            Encoded payload and datagram lengths come from real encoders or matching benchmark observations.
            UDP/IP headers are specification-calculated; TCP packet counts, cellular framing and
            physical-device energy were not measured. Sample schemas are processed by this site's calculator;
            no device traffic is transmitted. Use example values, not secrets.
          </p>
          <a href="/benchmark-methodology">Historical landing-page methodology</a><span> · </span
          ><a
            v-if="metadata"
            :href="`${metadata.researchUrl}/reports/CALCULATION-RULES.md`"
            target="_blank"
            rel="noopener noreferrer"
            >Calculation rules ↗</a
          >
        </footer>
      </div>
    </div>
    <ProtocolLabExplanation
      :result="inspected"
      :metric="inspectedMetric"
      :config="displayConfig"
      :metadata="metadata"
      @close="inspected = null"
    />
  </div>
</template>
<style src="~/assets/css/protocol-lab.css" />

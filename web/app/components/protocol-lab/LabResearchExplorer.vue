<script setup lang="ts">
import type { ResearchRecord, ResearchProfile, ResearchSchema } from '#shared/protocol-lab/types'
interface Page {
  total: number
  offset: number
  limit: number
  records: (ResearchRecord & { configuration: ResearchProfile; schemaDefinition: ResearchSchema })[]
}
const query = ref(''),
  status = ref(''),
  offset = ref(0),
  data = ref<Page | null>(null),
  pending = ref(false),
  error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  pending.value = true
  error.value = ''
  try {
    data.value = await $fetch<Page>('/api/protocol-lab/references', {
      query: { q: query.value, status: status.value, offset: offset.value, limit: 10 },
      signal: current.signal,
    })
  } catch {
    if (!current.signal.aborted) error.value = 'Could not load research records. Try again.'
  } finally {
    if (controller === current) pending.value = false
  }
}
watch([query, status], () => {
  offset.value = 0
  clearTimeout(timer)
  timer = setTimeout(load, 300)
})
watch(offset, load)
onUnmounted(() => {
  clearTimeout(timer)
  controller?.abort()
})
function toggle(event: Event) {
  if ((event.target as HTMLDetailsElement).open && !data.value) load()
}
</script>
<template>
  <details class="lab-panel lab-research" @toggle="toggle">
    <summary>
      <span><span class="lab-eyebrow">THE UNDERLYING EVIDENCE</span>Research Explorer</span
      ><span class="lab-help">Original archive + extension records · on demand</span>
    </summary>
    <div class="lab-research-controls">
      <label class="lab-label"
        >Stack, schema, security, delivery or ID<input
          v-model="query"
          type="search"
          class="lab-input"
          placeholder="e.g. OSCORE, impairment, esp32-original"
          aria-label="Search benchmark records" /></label
      ><label class="lab-label"
        >Status<select v-model="status" class="lab-input">
          <option value="">All statuses</option>
          <option value="passed">Passed</option>
          <option value="unsupported">Unsupported</option>
          <option value="failed">Failed</option>
        </select></label
      >
    </div>
    <p v-if="error" class="lab-error" role="alert">
      {{ error }} <button type="button" class="lab-link" @click="load">Retry</button>
    </p>
    <p class="lab-help" aria-live="polite">
      {{ pending ? 'Loading references…' : `${data?.total?.toLocaleString() ?? 0} matching configurations` }}
    </p>
    <div v-for="record in data?.records" :key="record.id" class="lab-research-record">
      <details>
        <summary>
          <span
            >{{ record.configuration.protocol_stack
            }}<small
              >{{ record.schema }} ·
              {{ record.configuration.security_configuration || 'No confidentiality' }} ·
              {{ record.configuration.delivery_mode }} · {{ record.test_status }}</small
            ></span
          ><code>{{ record.id.slice(0, 8) }}</code>
        </summary>
        <p class="lab-help">
          Original ID: {{ record.id }}. Raw source: {{ record.raw_artifact }}, line {{ record.raw_line }}.
          Consult measurement provenance for included layers.
        </p>
        <pre class="lab-code">{{ JSON.stringify(record, null, 2) }}</pre>
      </details>
    </div>
    <div class="lab-pagination">
      <button
        type="button"
        class="lab-button"
        :disabled="offset === 0 || pending"
        @click="offset = Math.max(0, offset - 10)"
      >
        Previous</button
      ><span>{{ data?.total ? offset + 1 : 0 }}–{{ Math.min(offset + 10, data?.total ?? 0) }}</span
      ><button
        type="button"
        class="lab-button"
        :disabled="offset + 10 >= (data?.total ?? 0) || pending"
        @click="offset += 10"
      >
        Next
      </button>
    </div>
  </details>
</template>

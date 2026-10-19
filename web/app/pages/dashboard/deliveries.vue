<template>
  <LegacyDeliveryHistory v-if="!enabled" />
  <main v-else class="mx-auto max-w-7xl space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Delivery</h1>
        <p class="mt-1 max-w-3xl text-sm text-[#9AA3B2]">
          Follow stored readings to your application. Retry and replay keep the
          original event ID. Your receiver should deduplicate it.
        </p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/docs/delivery" class="btn-ghost text-xs"
          >Delivery guide</NuxtLink
        ><NuxtLink to="/dashboard/destinations" class="btn-ghost text-xs"
          >Destinations</NuxtLink
        ><button
          class="btn-primary text-xs"
          :disabled="loading || busy"
          @click="load()"
        >
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </div>
    <p v-if="error" role="alert" class="banner banner-error">{{ error }}</p>
    <p v-if="notice" role="status" class="banner">{{ notice }}</p>
    <section
      v-if="overview"
      class="grid grid-cols-2 gap-3 lg:grid-cols-4"
      aria-label="Delivery overview"
    >
      <div v-for="metric in metrics" :key="metric.label" class="card p-4">
        <p class="text-xs text-[#9AA3B2]">{{ metric.label }}</p>
        <p class="mt-1 text-2xl font-semibold">{{ metric.count }}</p>
      </div>
    </section>
    <details v-if="overview?.destinations.length" class="card p-4">
      <summary class="cursor-pointer text-sm font-medium">
        Destination health · {{ overview.destinations.length }} endpoints
      </summary>
      <p class="my-2 text-xs text-[#9AA3B2]">
        Pausing retains queued work. An in-flight request may still finish.
        Automatic retries end after eight attempts or 24 hours; recovery
        payloads last seven days.
      </p>
      <div
        v-for="destination in overview.destinations"
        :key="destination.id"
        class="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-3"
      >
        <div>
          <p class="text-sm font-medium">
            {{ destination.name }} ·
            {{
              destination.paused_at
                ? 'Paused'
                : destination.enabled
                  ? 'Enabled'
                  : 'Disabled'
            }}
          </p>
          <p class="text-xs text-[#9AA3B2]">
            Backlog {{ destination.backlog }} · failed {{ destination.dead }} ·
            last success {{ formatDeliveryTime(destination.last_success) }}
          </p>
          <p class="text-xs text-[#9AA3B2]">
            Last 24 hours: {{ destination.failures_24h }} failed/unknown
            attempts of {{ destination.attempts_24h }} recorded attempts
          </p>
        </div>
        <div class="flex gap-2">
          <button
            class="btn-ghost text-xs"
            @click="filterDestination(destination.id)"
          >
            View deliveries</button
          ><button
            v-if="can('integrations.manage') && destination.enabled"
            class="btn-ghost text-xs"
            :disabled="busy"
            @click="pause(destination.id, !destination.paused_at)"
          >
            {{ destination.paused_at ? 'Resume' : 'Pause' }}
          </button>
        </div>
      </div>
    </details>
    <form
      class="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
      @submit.prevent="search"
    >
      <label class="label"
        >Delivery status<select v-model="filters.status" class="input">
          <option value="">All statuses</option>
          <option value="pending">Queued / retrying</option>
          <option value="sending">Sending</option>
          <option value="delivered">Delivered</option>
          <option value="dead">Failed / dead letter</option>
          <option value="skipped">Skipped / canceled</option>
        </select></label
      >
      <label class="label"
        >Device<select v-model="filters.device" class="input">
          <option value="">All devices</option>
          <option v-for="device in devices" :key="device.id" :value="device.id">
            {{ device.name }}
          </option>
        </select></label
      >
      <label class="label"
        >Destination<select v-model="filters.destination" class="input">
          <option value="">All destinations</option>
          <option
            v-for="destination in overview?.destinations || []"
            :key="destination.id"
            :value="destination.id"
          >
            {{ destination.name }}
          </option>
        </select></label
      >
      <label class="label"
        >Event identifier<input
          v-model="filters.event"
          class="input font-mono"
          placeholder="Event UUID"
      /></label>
      <details class="sm:col-span-2 lg:col-span-4">
        <summary class="cursor-pointer text-xs">More filters</summary>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="label"
            >From<input
              v-model="filters.from"
              type="datetime-local"
              class="input" /></label
          ><label class="label"
            >Until<input
              v-model="filters.to"
              type="datetime-local"
              class="input" /></label
          ><label class="label"
            >Error category<select v-model="filters.category" class="input">
              <option value="">All categories</option>
              <option v-for="category in categories" :key="category">
                {{ category }}
              </option>
            </select></label
          ><label class="label"
            >At least this many attempts<input
              v-model.number="filters.attempts"
              type="number"
              min="0"
              max="100"
              class="input" /></label
          ><label class="label"
            >Protocol<select v-model="filters.protocol" class="input">
              <option value="">All protocols</option>
              <option value="secure-v2">Secure V2</option>
              <option value="legacy">Historical compatibility</option>
            </select></label
          >
        </div>
      </details>
      <div class="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button class="btn-primary text-xs" :disabled="loading">
          Search deliveries</button
        ><button type="button" class="btn-ghost text-xs" @click="resetFilters">
          Clear filters</button
        ><button
          v-if="canRecover"
          type="button"
          class="btn-ghost text-xs"
          :disabled="busy || loading"
          @click="selectEligible"
        >
          Retry eligible matches</button
        ><button
          v-if="canRecover && selected.length"
          type="button"
          class="btn-ghost text-xs"
          :disabled="busy"
          @click="preview(selected, 'retry')"
        >
          Retry selected ({{ selected.length }})
        </button>
      </div>
    </form>
    <section
      v-if="recovery"
      class="card space-y-3 border-purple-400/40 p-4"
      aria-label="Confirm recovery"
    >
      <h2 class="text-sm font-semibold">
        {{
          recovery.action === 'cancel'
            ? 'Cancel queued work'
            : recovery.action === 'replay'
              ? 'Replay stored event'
              : 'Retry failed deliveries'
        }}
      </h2>
      <p class="text-sm">
        {{ recovery.eligible }} eligible of {{ recovery.ids.length }} selected.
        {{
          recovery.action === 'cancel'
            ? 'Canceled work will not be sent automatically.'
            : 'This schedules another attempt, not a new reading. The receiver may process a duplicate request.'
        }}
      </p>
      <p v-if="recovery.total" class="text-xs text-[#9AA3B2]">
        Previewing the oldest {{ recovery.ids.length }} of {{ recovery.total }}
        eligible failures matching these filters. Each action is limited to 100.
      </p>
      <label class="flex items-center gap-2 text-sm"
        ><input v-model="confirmed" type="checkbox" />{{
          recovery.action === 'cancel'
            ? 'I want to cancel these deliveries.'
            : 'I understand this can repeat downstream processing.'
        }}</label
      >
      <div class="flex gap-2">
        <button
          class="btn-primary text-xs"
          :disabled="
            !confirmed || busy || recovery.eligible !== recovery.ids.length
          "
          @click="recover"
        >
          {{ busy ? 'Scheduling…' : 'Confirm action' }}</button
        ><button
          class="btn-ghost text-xs"
          :disabled="busy"
          @click="recovery = null"
        >
          Dismiss
        </button>
      </div>
    </section>
    <p v-if="loading && !jobs.length" role="status" class="text-sm">
      Loading delivery history…
    </p>
    <section class="card overflow-hidden" aria-label="Delivery history">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th v-if="canRecover" scope="col">Select</th>
              <th scope="col">Status</th>
              <th scope="col">Reading</th>
              <th scope="col">Destination</th>
              <th scope="col">Attempts</th>
              <th scope="col">Last outcome</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in jobs" :key="job.id">
              <td v-if="canRecover">
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="job.id"
                  :disabled="
                    !['dead', 'skipped'].includes(job.status) ||
                    !job.payload_available ||
                    job.replay_count >= 3
                  "
                  :aria-label="`Select delivery ${job.id}`"
                />
              </td>
              <td>
                <span
                  class="status-pill"
                  :data-tone="deliveryTone(job.status)"
                  >{{
                    deliveryLabel(job.status, job.attempts, job.terminal_reason)
                  }}</span
                >
                <p
                  v-if="job.status === 'pending' && job.attempts"
                  class="mt-1 text-xs text-[#9AA3B2]"
                >
                  Next: {{ formatDeliveryTime(job.next_attempt_at) }}
                </p>
              </td>
              <td>
                <p class="text-sm">
                  {{ job.device_name || 'Historical reading' }}
                </p>
                <button
                  class="mt-1 max-w-[12rem] break-all text-left font-mono text-xs text-purple-200 underline"
                  @click="eventId = job.event_id"
                >
                  {{ job.event_id }}
                </button>
                <p class="text-xs text-[#9AA3B2]">
                  {{ formatDeliveryTime(job.created_at) }}
                </p>
              </td>
              <td>{{ destinationName(job.destination_id) }}</td>
              <td>
                {{ job.total_attempts }}
                <p class="text-xs text-[#9AA3B2]">
                  {{ job.replay_count }} recovery cycles
                </p>
              </td>
              <td class="max-w-[16rem] break-words text-xs">
                {{
                  job.last_error ||
                  (job.http_status
                    ? `HTTP ${job.http_status}`
                    : 'No failure recorded')
                }}
                <p v-if="!job.payload_available" class="mt-1 text-amber-200">
                  Recovery payload expired
                </p>
              </td>
              <td>
                <div class="flex flex-wrap gap-2">
                  <button
                    class="btn-ghost text-xs"
                    @click="eventId = job.event_id"
                  >
                    Trace</button
                  ><template v-if="canRecover"
                    ><button
                      v-if="
                        ['dead', 'skipped', 'delivered'].includes(job.status) && (job.status !== 'delivered' || can('delivery.replay')) &&
                        job.payload_available &&
                        job.replay_count < 3
                      "
                      class="btn-ghost text-xs"
                      :disabled="busy"
                      @click="
                        preview(
                          [job.id],
                          job.status === 'delivered' ? 'replay' : 'retry',
                        )
                      "
                    >
                      {{
                        job.status === 'delivered' ? 'Replay' : 'Retry'
                      }}</button
                    ><button
                      v-if="can('delivery.replay') && job.status === 'pending'"
                      class="btn-ghost text-xs"
                      :disabled="busy"
                      @click="preview([job.id], 'cancel')"
                    >
                      Cancel
                    </button></template
                  >
                </div>
              </td>
            </tr>
            <tr v-if="!jobs.length && !loading">
              <td
                :colspan="canRecover ? 7 : 6"
                class="py-8 text-center text-[#9AA3B2]"
              >
                No deliveries match these filters. Configure an enabled
                destination, then send a reading.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        class="flex items-center justify-between gap-3 border-t border-white/10 p-3"
      >
        <p class="text-xs text-[#9AA3B2]">
          Page {{ history.length + 1 }} · up to 50 deliveries
        </p>
        <div class="flex gap-2">
          <button
            class="btn-ghost text-xs"
            :disabled="loading || !history.length"
            @click="previousPage"
          >
            Previous</button
          ><button
            class="btn-ghost text-xs"
            :disabled="loading || !hasMore"
            @click="nextPage"
          >
            Next
          </button>
        </div>
      </div>
    </section>
    <DeliveryEventTrace
      v-if="eventId && currentOrgId"
      :event-id="eventId"
      :org-id="currentOrgId"
      @close="eventId = ''"
    />
    <details class="card p-4">
      <summary class="cursor-pointer text-sm">
        Existing TCP command delivery
      </summary>
      <p class="my-2 text-xs text-[#9AA3B2]">
        Device commands are separate from webhook delivery. Secure V2 UDP
        telemetry does not execute these historical TCP commands.
      </p>
      <ul class="space-y-2 text-sm">
        <li v-for="command in commands" :key="command.id">
          {{ command.command_type }} · {{ command.status }} ·
          {{ formatDeliveryTime(command.expires_at) }}
        </li>
        <li v-if="!commands.length">No recent commands.</li>
      </ul>
    </details>
  </main>
</template>
<script setup lang="ts">
import {
  deliveryLabel,
  deliveryTone,
  formatDeliveryTime,
  parseDeliveryRecords,
  recoveryError,
  type DeliveryRecord,
  type DeliveryOverview,
} from '#shared/delivery'
definePageMeta({ middleware: 'auth' })
const enabled = useRuntimeConfig().public.deliveryPipelineEnabled,
  db = useSupabaseClient(),
  route = useRoute()
const { currentOrgId, ensureOrganization, can } = useOrganization()
const canRecover=computed(()=>can('delivery.retry'))
const
  { devices, fetchDevices } = useDevices()
const jobs = ref<DeliveryRecord[]>([]),
  overview = ref<DeliveryOverview | null>(null),
  commands = ref<
    { id: string; command_type: string; status: string; expires_at: string }[]
  >([]),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  eventId = ref(''),
  selected = ref<string[]>([])
const emptyFilters = () => ({
  status: '',
  device: '',
  destination: '',
  event: '',
  from: '',
  to: '',
  category: '',
  attempts: 0,
  protocol: '',
})
const filters = reactive(emptyFilters()),
  categories = [
    'timeout',
    'network',
    'dns',
    'configuration',
    'http_transient',
    'http_permanent',
    'database',
    'policy',
    'lease_expired',
  ]
type Cursor = { at: string; id: string } | null
const history = ref<Cursor[]>([]),
  cursor = ref<Cursor>(null),
  hasMore = ref(false),
  confirmed = ref(false)
const recovery = ref<{
  ids: string[]
  eligible: number
  action: 'retry' | 'replay' | 'cancel'
  requestId: string
  total?: number
} | null>(null)
let generation = 0,
  ready = false
const metrics = computed(() => [
  { label: 'Queued / retrying', count: overview.value?.counts.pending || 0 },
  { label: 'Sending', count: overview.value?.counts.sending || 0 },
  { label: 'Delivered', count: overview.value?.counts.delivered || 0 },
  { label: 'Failed / dead letter', count: overview.value?.counts.dead || 0 },
])
function destinationName(id: string | null) {
  return (
    overview.value?.destinations.find((d) => d.id === id)?.name ||
    (id ? 'Historical destination' : 'Removed destination')
  )
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function dateFilter(value: string) {
  return value ? new Date(value).toISOString() : null
}
async function load() {
  if (!enabled || !currentOrgId.value) return
  const run = ++generation,
    org = currentOrgId.value
  loading.value = true
  error.value = ''
  selected.value = []
  try {
    if (filters.event && !uuid.test(filters.event))
      throw new Error('LOCAL_EVENT_ID')
    if (filters.from && filters.to && filters.from > filters.to)
      throw new Error('LOCAL_TIME_RANGE')
    const result = await Promise.all([
      db.rpc('delivery_search', {
        p_org_id: org,
        p_status: filters.status || null,
        p_device_id: filters.device || null,
        p_destination_id: filters.destination || null,
        p_event_id: filters.event || null,
        p_error_category: filters.category || null,
        p_from: dateFilter(filters.from),
        p_to: dateFilter(filters.to),
        p_before: cursor.value?.at || null,
        p_before_id: cursor.value?.id || null,
        p_limit: 51,
        p_min_attempts: filters.attempts || null,
        p_protocol: filters.protocol || null,
      }),
      db.rpc('delivery_overview', { p_org_id: org }),
      db
        .from('pending_commands')
        .select(
          'id,command_type,status,expires_at,devices!inner(organization_id)',
        )
        .eq('devices.organization_id', org)
        .order('created_at', { ascending: false })
        .limit(50),
    ])
    if (run !== generation || org !== currentOrgId.value) return
    for (const response of result) if (response.error) throw response.error
    const rows = parseDeliveryRecords(result[0].data),
      summary = result[1].data as unknown as DeliveryOverview
    if (!summary || !Array.isArray(summary.destinations) || !summary.counts)
      throw new Error('Invalid response')
    jobs.value = rows.slice(0, 50)
    hasMore.value = rows.length > 50
    overview.value = summary
    commands.value = result[2].data || []
  } catch (e) {
    if (run === generation)
      error.value =
        e instanceof Error && e.message === 'LOCAL_EVENT_ID'
          ? 'Enter a valid event UUID.'
          : e instanceof Error && e.message === 'LOCAL_TIME_RANGE'
            ? 'Choose an end time after the start time.'
            : recoveryError(e)
  } finally {
    if (run === generation) loading.value = false
  }
}
function search() {
  history.value = []
  cursor.value = null
  eventId.value = ''
  recovery.value = null
  void load()
}
function filterDestination(id: string) {
  filters.destination = id
  search()
}
function resetFilters() {
  Object.assign(filters, emptyFilters())
  search()
}
function nextPage() {
  const last = jobs.value.at(-1)
  if (!last) return
  history.value.push(cursor.value)
  cursor.value = { at: last.created_at, id: last.id }
  void load()
}
function previousPage() {
  cursor.value = history.value.pop() || null
  void load()
}
async function preview(ids: string[], action: 'retry' | 'replay' | 'cancel') {
  if (!currentOrgId.value || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  const org = currentOrgId.value,
    run = generation
  try {
    const result = await db.rpc('delivery_recovery', {
      p_org_id: org,
      p_ids: ids,
      p_action: `preview_${action}`,
      p_request_id: crypto.randomUUID(),
    })
    if (result.error) throw result.error
    if (org !== currentOrgId.value || run !== generation) return
    const value = result.data as { eligible: number }
    recovery.value = {
      ids: [...ids],
      eligible: value.eligible,
      action,
      requestId: crypto.randomUUID(),
    }
    confirmed.value = false
  } catch (e) {
    if (org === currentOrgId.value && run === generation)
      error.value = recoveryError(e)
  } finally {
    busy.value = false
  }
}
async function selectEligible() {
  if (!currentOrgId.value || busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  const org = currentOrgId.value,
    run = generation
  type Selection = { ids: string[]; eligible_total: number }
  let selection: Selection | null = null
  try {
    if (filters.event && !uuid.test(filters.event))
      throw new Error('Invalid event UUID')
    if (filters.from && filters.to && filters.from > filters.to)
      throw new Error('Invalid time range')
    const result = await db.rpc('delivery_recovery_selection', {
      p_org_id: org,
      p_destination_id: filters.destination || null,
      p_device_id: filters.device || null,
      p_event_id: filters.event || null,
      p_error_category: filters.category || null,
      p_from: dateFilter(filters.from),
      p_to: dateFilter(filters.to),
      p_min_attempts: filters.attempts || null,
      p_protocol: filters.protocol || null,
    })
    if (result.error) throw result.error
    if (org !== currentOrgId.value || run !== generation) return
    selection = result.data as unknown as Selection
    if (!selection || !Array.isArray(selection.ids))
      throw new Error('Invalid selection')
    if (!selection.ids.length)
      notice.value =
        'No eligible failed deliveries match these filters. This action selects only failed or skipped work, regardless of the status filter.'
  } catch (e) {
    if (org === currentOrgId.value && run === generation)
      error.value = recoveryError(e)
  } finally {
    busy.value = false
  }
  if (
    selection?.ids.length &&
    org === currentOrgId.value &&
    run === generation
  ) {
    await preview(selection.ids, 'retry')
    if (recovery.value) recovery.value.total = selection.eligible_total
  }
}
async function recover() {
  if (!recovery.value || !currentOrgId.value || !confirmed.value || busy.value)
    return
  busy.value = true
  error.value = ''
  const org = currentOrgId.value,
    action = recovery.value
  try {
    const result = await db.rpc('delivery_recovery', {
      p_org_id: org,
      p_ids: action.ids,
      p_action: action.action,
      p_request_id: action.requestId,
      p_confirm: true,
    })
    if (result.error) throw result.error
    if (org !== currentOrgId.value) return
    recovery.value = null
    notice.value =
      action.action === 'cancel'
        ? 'Queued work canceled.'
        : 'Recovery queued. Delivery has not yet been confirmed.'
    await load()
  } catch (e) {
    if (org === currentOrgId.value) error.value = recoveryError(e)
  } finally {
    busy.value = false
  }
}
async function pause(id: string, paused: boolean) {
  if (busy.value) return
  busy.value = true
  const org = currentOrgId.value
  try {
    const result = await db.rpc('pause_webhook_destination', {
      p_id: id,
      p_pause: paused,
      p_request_id: crypto.randomUUID(),
    })
    if (result.error) throw result.error
    if (org === currentOrgId.value) await load()
  } catch (e) {
    if (org === currentOrgId.value) error.value = recoveryError(e)
  } finally {
    busy.value = false
  }
}
watch(currentOrgId, () => {
  generation++
  jobs.value = []
  overview.value = null
  commands.value = []
  eventId.value = ''
  recovery.value = null
  notice.value = ''
  Object.assign(filters, emptyFilters())
  history.value = []
  cursor.value = null
  if (ready) {
    void fetchDevices()
    void load()
  }
})
onMounted(async () => {
  if (!enabled) return
  await ensureOrganization()
  await fetchDevices()
  if (typeof route.query.event === 'string' && uuid.test(route.query.event))
    filters.event = route.query.event
  if (
    typeof route.query.destination === 'string' &&
    uuid.test(route.query.destination)
  )
    filters.destination = route.query.destination
  ready = true
  await load()
})
onBeforeUnmount(() => generation++)
</script>

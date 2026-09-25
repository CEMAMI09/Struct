<template>
  <main class="mx-auto max-w-5xl space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm text-[#9AA3B2]">
          Webhook jobs are separate from stored telemetry. Retries keep the same event ID.
          Receivers should deduplicate it.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <NuxtLink to="/dashboard/destinations" class="btn-ghost text-xs">Destinations</NuxtLink>
        <button type="button" class="btn-primary text-xs" :disabled="loading" @click="load">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </div>

    <p v-if="error" role="alert" class="banner banner-error">{{ error }}</p>
    <p v-else-if="loading && !jobs.length && !commands.length" class="text-sm text-[#9AA3B2]">
      Loading delivery history…
    </p>

    <section class="card p-4">
      <h2 class="text-sm font-semibold">Device commands</h2>
      <p class="mt-1 text-xs text-[#9AA3B2]">
        These are queued TCP downlinks. Received means the device accepted the command. Executed means the handler reported completion. Unknown may have executed. The UDP SDK does not run these commands.
      </p>
      <p v-if="!loading && !commands.length" class="mt-3 text-sm text-[#9AA3B2]">No commands yet.</p>
      <div v-else-if="commands.length" class="table-scroll mt-3">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Command</th>
              <th scope="col">Status</th>
              <th scope="col">Command ID</th>
              <th scope="col">Expires</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="command in commands" :key="command.id">
              <td>{{ command.command_type }}</td>
              <td><span class="status-pill" :data-tone="commandTone(command.status)">{{ command.status }}</span></td>
              <td class="font-mono text-xs">{{ command.command_id }}</td>
              <td>{{ formatTime(command.expires_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2 class="text-sm font-semibold">Webhook deliveries</h2>
      <p v-if="!loading && !jobs.length" class="mt-2 text-sm text-[#9AA3B2]">
        No delivery jobs in this organization yet. Configure an HTTPS destination, then send an event.
      </p>
      <div v-else-if="jobs.length" class="card table-scroll mt-3">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Destination</th>
              <th scope="col">Event</th>
              <th scope="col">Attempts</th>
              <th scope="col">When</th>
              <th scope="col">Last error</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="job in jobs" :key="job.id">
              <tr>
                <td><span class="status-pill" :data-tone="deliveryTone(job.status, job.attempts)">{{ deliveryLabel(job.status, job.attempts) }}</span></td>
                <td class="max-w-[16rem] break-all">{{ job.destination_url }}</td>
                <td class="max-w-[10rem] break-all font-mono text-xs">{{ job.event_id }}</td>
                <td>{{ job.attempts }}</td>
                <td>{{ formatTime(job.created_at) }}</td>
                <td class="max-w-[14rem] break-words">{{ job.last_error || '—' }}</td>
                <td class="space-y-1">
                  <button type="button" class="btn-ghost text-xs" @click="showAttempts(job.id)">
                    {{ selected === job.id ? 'Hide attempts' : 'Attempts' }}
                  </button>
                  <button
                    v-if="job.status === 'dead' && canWrite"
                    type="button"
                    class="btn-ghost text-xs"
                    :disabled="loading || job.replay_count >= 3"
                    @click="replay(job.id)"
                  >
                    Replay same event
                  </button>
                </td>
              </tr>
              <tr v-if="selected === job.id">
                <td colspan="7">
                  <p v-if="!attempts.length" class="text-sm text-[#9AA3B2]">No attempts recorded.</p>
                  <ul v-else class="space-y-1 text-sm">
                    <li v-for="attempt in attempts" :key="attempt.id">
                      {{ formatTime(attempt.attempted_at) }} — {{ attempt.outcome }}: {{ attempt.detail }}
                    </li>
                  </ul>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const { currentOrgId, ensureOrganization, canWrite } = useOrganization()
const jobs = ref<any[]>([])
const attempts = ref<any[]>([])
const selected = ref('')
const loading = ref(false)
const error = ref('')
const commands = ref<any[]>([])
let generation = 0

function formatTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { timeZoneName: 'short' })
}

function deliveryLabel(status: string, attemptsCount: number) {
  if (status === 'pending' && attemptsCount > 0) return 'Pending retry'
  if (status === 'pending') return 'Delivery pending'
  if (status === 'sending') return 'Sending'
  if (status === 'delivered') return 'Delivered'
  if (status === 'skipped') return 'Skipped'
  if (status === 'dead') return 'Failed'
  return status
}

function deliveryTone(status: string, attemptsCount: number) {
  if (status === 'delivered') return 'ok'
  if (status === 'dead') return 'bad'
  if (status === 'sending' || (status === 'pending' && attemptsCount > 0)) return 'warn'
  if (status === 'pending') return 'info'
  return undefined
}

function commandTone(status: string) {
  if (status === 'executed' || status === 'acknowledged') return 'ok'
  if (status === 'failed' || status === 'rejected' || status === 'expired') return 'bad'
  if (status === 'unknown') return 'warn'
  return 'info'
}

async function load() {
  const run = ++generation
  loading.value = true
  error.value = ''
  jobs.value = []
  commands.value = []
  attempts.value = []
  selected.value = ''
  try {
    await ensureOrganization()
    const org = currentOrgId.value
    if (!org) return
    const { data, error: err } = await supabase
      .from('webhook_deliveries')
      .select('id,event_id,destination_url,status,attempts,replay_count,created_at,last_error')
      .eq('organization_id', org)
      .order('created_at', { ascending: false })
      .limit(100)
    if (err) throw err
    if (run === generation) jobs.value = data || []
    const commandResult = await supabase
      .from('pending_commands')
      .select('id,command_id,command_type,status,expires_at,devices!inner(organization_id)')
      .eq('devices.organization_id', org)
      .order('created_at', { ascending: false })
      .limit(100)
    if (commandResult.error) throw commandResult.error
    if (run === generation) commands.value = commandResult.data || []
  } catch (e: any) {
    if (run === generation) error.value = e.message || 'Unable to load delivery history'
  } finally {
    if (run === generation) loading.value = false
  }
}

async function showAttempts(id: string) {
  if (selected.value === id) {
    selected.value = ''
    attempts.value = []
    return
  }
  const run = generation
  selected.value = id
  attempts.value = []
  const { data, error: err } = await supabase
    .from('webhook_attempts')
    .select('id,attempted_at,outcome,detail')
    .eq('delivery_id', id)
    .order('attempted_at', { ascending: false })
    .limit(40)
  if (run !== generation || selected.value !== id) return
  if (err) error.value = err.message
  else attempts.value = data || []
}

async function replay(id: string) {
  loading.value = true
  const { error: err } = await supabase.rpc('replay_webhook_delivery', { p_id: id })
  if (err) {
    error.value = err.message
    loading.value = false
    return
  }
  await load()
}

watch(currentOrgId, () => {
  void load()
})
onMounted(load)
</script>

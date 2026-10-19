<template>
  <div class="mx-auto max-w-6xl space-y-5">
    <header class="flex flex-wrap justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Audit history</h1>
        <p class="mt-2 text-sm text-[#9AA3B2]">
          Server-recorded administrative actions. Normal application roles
          cannot edit records. Unknown historical actors remain unknown.
        </p>
      </div>
      <NuxtLink to="/docs/enterprise" class="btn-ghost">View guide</NuxtLink>
    </header>
    <p v-if="error" role="alert" class="text-red-300">{{ error }}</p>
    <form class="card grid gap-3 p-4 sm:grid-cols-3" @submit.prevent="search">
      <label v-for="(label, k) in filterLabels" :key="k" class="label"
        >{{ label
        }}<input
          v-model="filters[k]"
          class="input"
          :type="['from', 'to'].includes(k) ? 'datetime-local' : 'text'"
          maxlength="150" /></label
      ><button class="btn-primary" :disabled="loading">
        Search audit history</button
      ><button
        v-if="can('audit.export')"
        type="button"
        class="btn-ghost"
        :disabled="loading"
        @click="exportHistory"
      >
        Export up to 500 events
      </button>
    </form>
    <p class="text-xs text-[#9AA3B2]">
      UTC filters. Cursor pagination, newest first. Safe metadata only; exports
      are authorized and audited. Default retention is 90 days, not a compliance
      certification.
    </p>
    <p v-if="loading" role="status">Loading audit evidence…</p>
    <section class="card divide-y divide-white/10" aria-label="Audit events">
      <p v-if="!events.length && !loading" class="p-4">
        No matching events, or no retained audit evidence.
      </p>
      <details v-for="e in events" :key="e.id" class="p-4">
        <summary class="cursor-pointer">
          <span class="font-medium">{{
            e.event_action.replaceAll('_', ' ').replaceAll('.', ' · ')
          }}</span
          ><span class="ml-3 text-xs text-[#9AA3B2]"
            >{{ e.outcome }} ·
            {{ new Date(e.created_at).toLocaleString() }}</span
          ><span class="mt-1 block break-all text-xs"
            >{{ e.table_name }} · {{ e.record_id }} · actor
            {{ e.user_id || e.actor_type }}</span
          >
        </summary>
        <dl class="mt-3 text-xs">
          <dt>Request / correlation</dt>
          <dd class="break-all">{{ e.request_id || 'Unavailable' }}</dd>
          <dt>Reference</dt>
          <dd>{{ e.reference_id || 'Unavailable' }}</dd>
        </dl>
        <pre class="mt-3 max-h-64 overflow-auto rounded bg-black p-3 text-xs">{{
          JSON.stringify(
            { before: e.previous_data, after: e.new_data },
            null,
            2,
          )
        }}</pre>
      </details>
    </section>
    <button
      v-if="hasMore"
      class="btn-ghost"
      :disabled="loading"
      @click="loadMore"
    >
      Older events
    </button>
  </div>
</template>
<script setup lang="ts">
const { currentOrgId, ensureOrganization, can } = useOrganization(),
  events = ref<any[]>([]),
  error = ref(''),
  loading = ref(false),
  hasMore = ref(false)
const filterLabels = {
    actor: 'Actor user ID',
    action: 'Exact action',
    resource: 'Resource type',
    id: 'Resource ID',
    outcome: 'Outcome',
    reference: 'Job/reference ID',
    from: 'From (UTC)',
    to: 'To (UTC)',
  },
  filters = reactive<Record<string, string>>(
    Object.fromEntries(Object.keys(filterLabels).map((k) => [k, ''])),
  )
let generation = 0,
  initialized = false
function query() {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => [
        k,
        ['from', 'to'].includes(k) ? new Date(v + 'Z').toISOString() : v,
      ]),
  )
}
async function load(append = false) {
  const org = currentOrgId.value,
    g = ++generation
  if (!org) return
  loading.value = true
  error.value = ''
  try {
    const last = append ? events.value.at(-1) : null,
      r = await $fetch<{ events: any[]; limit: number; hasMore: boolean }>(
        '/api/enterprise/audit',
        {
          query: {
            orgId: org,
            ...query(),
            ...(last ? { before: last.created_at, beforeId: last.id } : {}),
          },
        },
      )
    if (org !== currentOrgId.value || g !== generation) return
    events.value = append ? [...events.value, ...r.events] : r.events
    hasMore.value = r.hasMore
  } catch (e: any) {
    if (g === generation) {
      events.value = []
      error.value = e?.data?.message || 'Audit history unavailable.'
    }
  } finally {
    if (g === generation) loading.value = false
  }
}
function search() {
  return load(false)
}
function loadMore() {
  return load(true)
}
async function exportHistory() {
  const org = currentOrgId.value,
    g = generation
  loading.value = true
  try {
    const r = await $fetch<{ events: any[]; limit: number; hasMore: boolean }>(
      '/api/enterprise/audit',
      {
        query: { orgId: org, ...query(), export: 'true' },
      },
    )
    if (org !== currentOrgId.value || g !== generation) return
    const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { format: 'struct-audit-v1', workspace: org, events: r.events },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      ),
      a = document.createElement('a')
    a.href = url
    a.download = 'struct-audit.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e: any) {
    error.value = e?.data?.message || 'Export failed.'
  } finally {
    loading.value = false
  }
}
watch(currentOrgId, () => {
  generation++
  events.value = []
  if (initialized) void load()
})
onMounted(async () => {
  await ensureOrganization()
  initialized = true
  await load()
})
onBeforeUnmount(() => generation++)
</script>

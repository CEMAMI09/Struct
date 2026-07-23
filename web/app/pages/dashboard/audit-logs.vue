<template>
  <div class="mx-auto max-w-5xl">
    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-lg font-semibold text-[#E8EAEF]">Audit Log</h2>
        <p class="text-sm text-[#8B93A7]">
          Immutable database-level history for devices, schemas, and destinations.
        </p>
      </div>
      <button
        v-if="isEnterprise"
        class="btn-ghost text-xs"
        type="button"
        :disabled="loading"
        @click="fetchAuditLogs"
      >
        {{ loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </div>

    <div v-if="!isEnterprise" class="card p-8 text-center">
      <p class="font-medium text-[#E8EAEF]">Scale plan feature</p>
      <p class="mt-2 text-sm text-[#8B93A7]">
        Immutable audit-log access is available on the Scale plan.
      </p>
    </div>

    <template v-else>
      <p v-if="error" class="mb-4 text-sm text-red-400">{{ error }}</p>

      <div class="card divide-y divide-[#2A2F3A]">
        <div v-if="loading && !auditLogs.length" class="p-8 text-center text-sm text-[#8B93A7]">
          Loading audit history…
        </div>
        <div v-else-if="!auditLogs.length" class="p-8 text-center text-sm text-[#8B93A7]">
          No infrastructure changes have been recorded yet.
        </div>

        <details v-for="entry in auditLogs" :key="entry.id" class="group p-4">
          <summary class="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2">
            <span
              class="rounded px-2 py-0.5 font-mono text-[10px] font-semibold"
              :class="actionClass(entry.action)"
            >
              {{ entry.action }}
            </span>
            <span class="font-mono text-sm text-[#E8EAEF]">{{ entry.table_name }}</span>
            <span class="font-mono text-xs text-[#8B93A7]">{{ shortId(entry.record_id) }}</span>
            <span class="ml-auto text-xs text-[#8B93A7]">{{ formatDate(entry.created_at) }}</span>
          </summary>

          <div class="mt-4 grid gap-3 lg:grid-cols-2">
            <div>
              <p class="label">Previous state</p>
              <pre class="mono mt-1 max-h-80 overflow-auto rounded-lg bg-[#0F1115] p-3 text-xs text-[#8B93A7]">{{ formatData(entry.previous_data) }}</pre>
            </div>
            <div>
              <p class="label">New state</p>
              <pre class="mono mt-1 max-h-80 overflow-auto rounded-lg bg-[#0F1115] p-3 text-xs text-[#38B6FF]">{{ formatData(entry.new_data) }}</pre>
            </div>
          </div>
          <p class="mt-3 font-mono text-[10px] text-[#8B93A7]">
            Actor: {{ entry.user_id || 'system / service role' }}
          </p>
        </details>
      </div>

      <p class="mt-3 text-right text-[10px] text-[#8B93A7]">
        Showing the latest 200 events. Secret values are hidden in this view.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

import type { AuditAction } from '~/types'

const { currentOrgId, isEnterprise, ensureOrganization } = useOrganization()
const { auditLogs, loading, error, fetchAuditLogs } = useAuditLogs()

onMounted(async () => {
  await ensureOrganization()
  await fetchAuditLogs()
})

watch(currentOrgId, () => {
  fetchAuditLogs()
})

function shortId(id: string) {
  return `${id.slice(0, 8)}…`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function actionClass(action: AuditAction) {
  if (action === 'INSERT') return 'bg-emerald-400/10 text-emerald-300'
  if (action === 'DELETE') return 'bg-red-400/10 text-red-300'
  return 'bg-amber-400/10 text-amber-300'
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      ['api_key', 'encryption_key'].includes(key) && item ? '[REDACTED]' : redactSecrets(item),
    ]),
  )
}

function formatData(value: Record<string, unknown> | null) {
  return value ? JSON.stringify(redactSecrets(value), null, 2) : '—'
}
</script>

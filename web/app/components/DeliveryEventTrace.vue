<template>
  <section class="card space-y-4 p-4" aria-label="Event trace">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="font-semibold">Event trace</h2>
        <p class="break-all font-mono text-xs text-[#9AA3B2]">{{ eventId }}</p>
      </div>
      <button class="btn-ghost text-xs" @click="$emit('close')">
        Close trace
      </button>
    </div>
    <p v-if="loading" role="status">Loading recorded evidence…</p>
    <p v-if="error" role="alert" class="banner banner-error">{{ error }}</p>
    <template v-if="detail">
      <p class="text-sm text-[#9AA3B2]">
        Stored telemetry and webhook delivery are separate guarantees. A device
        receipt proves database acceptance; HTTP 2xx proves the receiver
        responded successfully. Retries can produce duplicate requests.
      </p>
      <dl v-if="detail.event" class="grid gap-2 text-sm sm:grid-cols-2">
        <div>Device: {{ detail.event.device_name || 'Removed device' }}</div>
        <div>
          {{ detail.event.protocol }} · slot
          {{ detail.event.schema_slot ?? 'unavailable' }}
        </div>
        <div>
          Sequence: {{ detail.event.sequence ?? 'unavailable' }} · reading
          {{ detail.event.record_index ?? 'unavailable' }}
        </div>
        <div>Sample time: {{ formatDeliveryTime(detail.event.sample_at) }}</div>
      </dl>
      <p v-else class="text-sm text-amber-200">
        No device-ingestion metadata is associated with this event. Notifications
        and historical deliveries may have delivery evidence only, shown below.
      </p>
      <div
        v-if="detail.event?.device_id"
        class="flex flex-wrap gap-4 text-xs text-purple-200"
      >
        <NuxtLink
          :to="`/dashboard?device=${detail.event.device_id}`"
          class="underline"
          >Device telemetry</NuxtLink
        >
        <NuxtLink
          :to="`/dashboard/schema?device=${detail.event.device_id}`"
          class="underline"
          >Schema</NuxtLink
        >
        <NuxtLink
          :to="`/dashboard/debugger?device=${detail.event.device_id}`"
          class="underline"
          >Device diagnostics</NuxtLink
        >
      </div>
      <ol class="space-y-3 border-l border-purple-400/30 pl-4">
        <li v-for="entry in timeline" :key="entry.key">
          <p class="text-xs text-[#9AA3B2]">
            {{ formatDeliveryTime(entry.at) }}
          </p>
          <p class="text-sm font-medium">{{ entry.label }}</p>
          <p v-if="entry.detail" class="break-words text-xs text-[#9AA3B2]">
            {{ entry.detail }}
          </p>
        </li>
      </ol>
      <details
        v-for="delivery in detail.deliveries.filter(
          (d) => d.integration_snapshot,
        )"
        :key="delivery.id"
      >
        <summary class="cursor-pointer text-sm">
          {{ delivery.integration_snapshot?.kind }} · routing version
          {{ delivery.integration_snapshot?.version }}
        </summary>
        <p class="my-2 text-xs text-[#9AA3B2]">
          This decision was recorded at ingestion. Retries and replay use this
          saved rule and mapping, even after configuration changes.
        </p>
        <pre class="overflow-auto text-xs">{{
          JSON.stringify(
            {
              route: delivery.integration_snapshot?.route,
              mapping_version:
                delivery.integration_snapshot?.mapping_version ||
                delivery.integration_snapshot?.version,
              mapping: delivery.integration_snapshot?.mapping,
            },
            null,
            2,
          )
        }}</pre>
        <NuxtLink
          to="/dashboard/integrations"
          class="text-xs text-purple-200 underline"
          >Integration configuration</NuxtLink
        >
      </details>
      <details>
        <summary class="cursor-pointer text-sm">
          Gateway evidence and response details
        </summary>
        <p class="my-2 text-xs text-[#9AA3B2]">
          Gateway stages appear only when authenticated capture was enabled.
          Missing capture does not prove packet loss. Attempt timestamps
          describe worker claims and database completion; socket-send timing is
          not recorded separately.
        </p>
        <div
          v-for="attempt in detail.attempts"
          :key="attempt.id"
          class="border-t border-white/10 py-2 text-xs"
        >
          Attempt {{ attempt.attempt_number ?? 'historical' }} ·
          {{ attempt.outcome }} · HTTP
          {{ attempt.http_status ?? 'not observed' }} ·
          {{ attempt.latency_ms ?? '—' }} ms ·
          {{ attempt.error_category || 'no failure category' }}
          <span v-if="attempt.provider_receipt">
            · Provider receipt: {{ attempt.provider_receipt }}</span
          >
        </div>
        <pre
          v-for="(trace, index) in detail.traces"
          :key="index"
          class="overflow-x-auto whitespace-pre-wrap break-all text-xs"
          >{{ JSON.stringify(trace, null, 2) }}</pre
        >
        <p v-if="!detail.traces.length" class="text-xs">
          No authenticated gateway capture available for this event.
        </p>
      </details>
    </template>
  </section>
</template>
<script setup lang="ts">
import {
  eventTimeline,
  formatDeliveryTime,
  recoveryError,
  type EventDetail,
} from '#shared/delivery'
const props = defineProps<{ eventId: string; orgId: string }>()
defineEmits<{ close: [] }>()
const db = useSupabaseClient(),
  detail = shallowRef<EventDetail | null>(null),
  loading = ref(false),
  error = ref('')
let generation = 0
const timeline = computed(() =>
  detail.value ? eventTimeline(detail.value) : [],
)
watch(
  () => [props.eventId, props.orgId],
  async () => {
    const run = ++generation
    detail.value = null
    error.value = ''
    loading.value = true
    try {
      const result = await db.rpc('delivery_event_detail', {
        p_org_id: props.orgId,
        p_event_id: props.eventId,
      })
      if (result.error) throw result.error
      const value = result.data as unknown as EventDetail
      if (
        !value ||
        !Array.isArray(value.attempts) ||
        !Array.isArray(value.deliveries)
      )
        throw new Error('Invalid response')
      if (run === generation)
        detail.value = {
          ...value,
          traces: value.traces || [],
          actions: value.actions || [],
        }
    } catch (e) {
      if (run === generation) error.value = recoveryError(e)
    } finally {
      if (run === generation) loading.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => generation++)
</script>

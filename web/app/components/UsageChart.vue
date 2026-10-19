<template>
  <div class="card p-4">
    <h2 class="font-semibold">{{ title }}</h2>
    <p class="mt-1 text-xs text-[#9AA3B2]">{{ note }}</p>
    <p v-if="!buckets.length" class="mt-4 text-sm text-[#9AA3B2]">
      No recorded measurements in this window.
    </p>
    <div
      v-else
      class="mt-4 flex h-44 items-end gap-1 overflow-x-auto"
      role="list"
      :aria-label="title"
    >
      <button
        v-for="b in visible"
        :key="b.bucket"
        class="min-w-2 flex-1 rounded-t bg-[#793cff] focus:outline focus:outline-2 focus:outline-white"
        :style="{ height: height(b) + '%' }"
        :aria-label="label(b)"
        :title="label(b)"
        @click="selected = label(b)"
      ></button>
    </div>
    <p role="status" class="mt-2 min-h-5 text-xs text-[#9AA3B2]">
      {{
        selected ||
        'Tap or focus a bar to inspect a recorded bucket. Missing buckets are not zero-filled.'
      }}
    </p>
    <details v-if="buckets.length">
      <summary class="cursor-pointer text-xs text-[#b79bff]">
        Accessible measurement list
      </summary>
      <div class="max-h-56 overflow-auto">
        <p v-for="b in visible" :key="b.bucket" class="py-1 text-xs">
          {{ label(b) }}
        </p>
      </div>
    </details>
  </div>
</template>
<script setup lang="ts">
import type { MetricBucket } from '#shared/observability'
import { counter, formatBytes } from '#shared/observability'
const props = defineProps<{
    buckets: MetricBucket[]
    title: string
    metric: string
    note: string
    timezone: string
  }>(),
  selected = ref('')
const visible = computed(() =>
  props.buckets
    .filter(
      (b) =>
        props.metric !== 'application' || counter(b.application || '0') > 0n,
    )
    .slice(-240),
)
const max = computed(() =>
  visible.value.reduce(
    (m, b) =>
      counter(b[props.metric] || '0') > m ? counter(b[props.metric] || '0') : m,
    1n,
  ),
)
const height = (b: MetricBucket) =>
  Math.max(
    1,
    Number((counter(b[props.metric] || '0') * 10000n) / max.value) / 100,
  )
function label(b: MetricBucket) {
  return `${new Date(b.bucket).toLocaleString(undefined, { timeZone: props.timezone })}: ${props.metric === 'application' ? formatBytes(b[props.metric] || '0') : b[props.metric] || '0'} ${props.metric}`
}
</script>

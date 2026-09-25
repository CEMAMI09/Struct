<template>
  <span class="inline-flex items-center gap-1.5" :title="label">
    <span
      class="inline-block h-2 w-2 rounded-full"
      :class="online ? 'bg-[#8fd4ae]' : 'bg-[#6f7888]'"
      aria-hidden="true"
    />
    <span v-if="showLabel" class="text-[10px] text-[#9AA3B2]">{{ online ? '30s' : 'older' }}</span>
    <span v-else class="sr-only">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  online: boolean
  showLabel?: boolean
}>()

const label = computed(() =>
  props.online ? 'Packet stored in the last 30 seconds' : 'No packet stored in the last 30 seconds',
)
</script>

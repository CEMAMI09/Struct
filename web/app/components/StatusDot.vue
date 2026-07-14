<template>
  <span
    class="inline-block h-2 w-2 rounded-full"
    :class="online ? 'bg-[#00FFA3] shadow-[0_0_8px_#00FFA3]' : 'bg-[#4A5160]'"
    :title="online ? 'Online' : 'Offline'"
  />
</template>

<script setup lang="ts">
defineProps<{ online: boolean }>()
</script>

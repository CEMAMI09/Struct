<template>
  <span
    class="inline-block h-2 w-2 rounded-full"
    :class="online ? 'bg-[#3d9a6a]' : 'bg-[#3a4050]'"
    :title="online ? 'Online' : 'Offline'"
  />
</template>

<script setup lang="ts">
defineProps<{ online: boolean }>()
</script>

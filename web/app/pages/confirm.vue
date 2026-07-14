<template>
  <div class="card p-6 text-center">
    <p class="text-sm text-[#8B93A7]">Confirming session…</p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

onMounted(() => {
  navigateTo('/dashboard')
})
</script>

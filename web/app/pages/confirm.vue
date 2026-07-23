<template>
  <div class="card p-6 text-center">
    <p class="text-sm text-[#8B93A7]">Confirming session…</p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const user = useSupabaseUser()

watch(
  user,
  (u) => {
    if (u) {
      return navigateTo('/dashboard', { replace: true })
    }
  },
  { immediate: true },
)
</script>

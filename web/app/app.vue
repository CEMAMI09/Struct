<template>
  <div v-if="authPending" class="grid min-h-dvh place-items-center bg-[#0F1115] text-[#9AA3B2]" role="status">Opening your workspace…</div>
  <NuxtLayout v-else>
    <NuxtPage :page-key="(route) => route.fullPath" />
  </NuxtLayout>
</template>

<script setup lang="ts">
const authPending=useState('auth-return-pending',()=>false)
</script>

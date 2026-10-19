<template>
  <EnterpriseWorkspace v-if="enabled" mode="security" />
  <p v-else>Enterprise security is not activated on this deployment.</p>
</template>
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const enabled = useRuntimeConfig().public.enterpriseEnabled
</script>

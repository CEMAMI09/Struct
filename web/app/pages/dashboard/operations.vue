<template>
  <EnterpriseWorkspace v-if="enabled" mode="operations" />
  <p v-else>Enterprise operations are not activated on this deployment.</p>
</template>
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const enabled = useRuntimeConfig().public.enterpriseEnabled
</script>

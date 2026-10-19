<template>
  <DeviceOperations v-if="enabled" />
  <p v-else>Secure device operations are not activated on this deployment.</p>
</template>
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const enabled = useRuntimeConfig().public.deviceOperationsEnabled
</script>

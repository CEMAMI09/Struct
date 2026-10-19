<template>
  <FleetManagement v-if="available" />
  <LegacyDevices v-else />
</template>
<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const available = useRuntimeConfig().public.fleetEnabled
</script>

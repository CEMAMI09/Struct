<template>
  <div class="h-[calc(100vh-8rem)]">
    <LiveDebugger :devices="devices" :schemas="schemas" />
  </div>
</template>

<script setup lang="ts">
const { devices, schemas, fetchDevices } = useDevices()
onMounted(fetchDevices)
</script>

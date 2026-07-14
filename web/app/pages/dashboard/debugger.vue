<template>
  <div class="min-h-0 lg:h-[calc(100vh-8rem)]">
    <LiveDebugger :devices="devices" :schemas="schemas" />
  </div>
</template>

<script setup lang="ts">
const { devices, schemas, fetchDevices } = useDevices()
onMounted(fetchDevices)
</script>

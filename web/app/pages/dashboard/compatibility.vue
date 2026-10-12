<template><div class="mx-auto max-w-3xl space-y-4"><h2 class="text-lg font-semibold">Existing firmware compatibility</h2><p class="banner">Historical tooling for existing devices only. New projects use Secure V2. Enrollment preserves existing firmware while you migrate to unused immutable slots.</p><NuxtLink to="/dashboard/schema" class="btn-primary">Set up Secure V2</NuxtLink><NuxtLink to="/docs/compatibility" class="ml-3 text-[#b79bff]">Migration guide</NuxtLink><SchemaBuilder :devices="existingDevices" :schemas="schemas" :schema-versions="schemaVersions" /><details class="card p-4"><summary>Historical packet preview</summary><NuxtLink to="/dashboard/profiles" class="underline">Existing fleet profiles</NuxtLink><LazyLiveDebugger :devices="existingDevices" :schemas="schemas" /></details></div></template>
<script setup lang="ts">
definePageMeta({middleware:'auth'})
const {devices,schemas,schemaVersions,fetchDevices}=useDevices()
const existingDevices=computed(()=>devices.value.filter(d=>schemas.value[d.id]?.schema_definition.length))
onMounted(()=>fetchDevices())
</script>

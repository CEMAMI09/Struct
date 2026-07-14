<template>
  <div class="mx-auto flex min-h-[calc(100vh-8rem)] max-w-3xl flex-col">
    <p v-if="error" class="mb-3 text-sm text-red-400">{{ error }}</p>
    <p v-else-if="loading" class="mb-3 text-sm text-[#8B93A7]">Loading devices…</p>
    <p v-else-if="!devices.length" class="mb-3 text-sm text-[#8B93A7]">
      No devices yet —
      <NuxtLink to="/dashboard/devices" class="text-[#38B6FF] hover:underline">create one</NuxtLink>
      first.
    </p>
    <SchemaBuilder
      class="min-h-0 flex-1"
      :devices="devices"
      :schemas="schemas"
      :schema-versions="schemaVersions"
    />
  </div>
</template>

<script setup lang="ts">
const { devices, schemas, schemaVersions, loading, error, fetchDevices } = useDevices()
const user = useSupabaseUser()

onMounted(fetchDevices)

// Auth can hydrate after mount on a hard reload — refetch once the user is ready
watch(
  user,
  (u, prev) => {
    if (u && !prev) fetchDevices()
  },
)
</script>

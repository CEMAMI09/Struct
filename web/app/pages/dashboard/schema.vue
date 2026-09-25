<template>
  <div class="mx-auto flex min-h-0 w-full max-w-3xl flex-col lg:min-h-[calc(100vh-8rem)]">
    <p v-if="error" class="mb-3 text-sm text-red-400">{{ error }}</p>
    <p v-else-if="loading && !devices.length" class="mb-3 text-sm text-[#8B93A7]">
      Loading devices…
    </p>
    <p v-else-if="!loading && !devices.length" class="mb-3 text-sm text-[#9AA3B2]">
      No devices yet —
      <NuxtLink to="/dashboard/devices" class="text-[#b79bff] hover:underline">create one</NuxtLink>
      first.
    </p>
    <div class="mb-3 flex flex-wrap gap-2">
      <NuxtLink to="/dashboard/devices" class="btn-ghost text-xs">Devices</NuxtLink>
      <NuxtLink to="/dashboard/debugger" class="btn-ghost text-xs">Diagnostics</NuxtLink>
    </div>
    <SchemaBuilder
      v-if="devices.length || !loading"
      class="min-h-0 flex-1"
      :devices="devices"
      :schemas="schemas"
      :schema-versions="schemaVersions"
    />
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { devices, schemas, schemaVersions, loading, error, fetchDevices } = useDevices()
const user = useSupabaseUser()
const selectedDeviceId = useState('schema-selected-device', () => '')

async function load() {
  await fetchDevices()
  const requested = route.query.device
  if (typeof requested === 'string' && devices.value.some((device) => device.id === requested)) {
    selectedDeviceId.value = requested
  }
}

onMounted(load)

// Auth can hydrate after mount on a hard reload — refetch once the user is ready
watch(
  user,
  (u, prev) => {
    if (u && !prev) load()
  },
)
</script>

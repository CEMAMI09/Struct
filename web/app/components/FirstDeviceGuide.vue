<template>
  <section class="card p-5" aria-labelledby="first-device-title">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-[#b79bff]">Getting started</p>
        <h2 id="first-device-title" class="mt-1 text-base font-semibold text-[#E8EAEF]">
          Send your first device event
        </h2>
        <p class="mt-1 text-sm text-[#9AA3B2]">
          Complete these steps for the selected device. A stored event will appear below.
        </p>
      </div>
      <span class="status-pill" data-tone="info">{{ completedCount }} of 3 complete</span>
    </div>

    <ol class="mt-5 grid gap-3 lg:grid-cols-3">
      <li class="rounded-lg border border-white/10 bg-black/30 p-4">
        <div class="flex items-center gap-2">
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold"
            :class="hasDevice ? 'bg-[#245c3d] text-[#8fd4ae]' : 'bg-[#2A2F3A] text-[#E8EAEF]'"
            aria-hidden="true">{{ hasDevice ? '✓' : '1' }}</span>
          <h3 class="text-sm font-medium text-[#E8EAEF]">Create a device</h3>
        </div>
        <p class="mt-2 text-xs leading-5 text-[#9AA3B2]">
          Save the key ID and one-time API secret when you create it. The secret signs each frame.
        </p>
        <NuxtLink v-if="!hasDevice && canWrite" to="/dashboard/devices?create=1" class="btn-primary mt-3 text-xs">
          Add device
        </NuxtLink>
        <p v-else-if="!hasDevice" class="mt-3 text-xs text-[#E6C27A]">Ask an owner or admin to add a device.</p>
        <NuxtLink v-else to="/dashboard/devices" class="mt-3 inline-block text-xs text-[#b79bff] hover:underline">
          View devices
        </NuxtLink>
      </li>

      <li class="rounded-lg border border-white/10 bg-black/30 p-4">
        <div class="flex items-center gap-2">
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold"
            :class="hasSchema ? 'bg-[#245c3d] text-[#8fd4ae]' : 'bg-[#2A2F3A] text-[#E8EAEF]'"
            aria-hidden="true">{{ hasSchema ? '✓' : '2' }}</span>
          <h3 class="text-sm font-medium text-[#E8EAEF]">Publish a schema</h3>
        </div>
        <p class="mt-2 text-xs leading-5 text-[#9AA3B2]">
          Add fields in wire order, save, then download the encoder for your language.
        </p>
        <NuxtLink :to="schemaUrl" class="mt-3 inline-block text-xs text-[#b79bff] hover:underline">
          {{ hasSchema ? 'View schema and encoder' : 'Open schema builder' }}
        </NuxtLink>
      </li>

      <li class="rounded-lg border border-white/10 bg-black/30 p-4">
        <div class="flex items-center gap-2">
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold"
            :class="hasTelemetry ? 'bg-[#245c3d] text-[#8fd4ae]' : 'bg-[#2A2F3A] text-[#E8EAEF]'"
            aria-hidden="true">{{ hasTelemetry ? '✓' : '3' }}</span>
          <h3 class="text-sm font-medium text-[#E8EAEF]">Send and verify</h3>
        </div>
        <p class="mt-2 text-xs leading-5 text-[#9AA3B2]">
          Use the SDK with your gateway’s UDP host and port. Check Diagnostics if no event appears.
        </p>
        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <a href="/sdk/struct-sdk.zip" download class="text-[#b79bff] hover:underline">Download SDK</a>
          <NuxtLink :to="diagnosticsUrl" class="text-[#b79bff] hover:underline">Open diagnostics</NuxtLink>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{
  deviceId?: string | null
  hasDevice: boolean
  hasSchema: boolean
  hasTelemetry: boolean
  canWrite: boolean
}>()

const completedCount = computed(() => Number(props.hasDevice) + Number(props.hasSchema) + Number(props.hasTelemetry))
const schemaUrl = computed(() => props.deviceId ? `/dashboard/schema?device=${encodeURIComponent(props.deviceId)}` : '/dashboard/schema')
const diagnosticsUrl = computed(() => props.deviceId ? `/dashboard/debugger?device=${encodeURIComponent(props.deviceId)}` : '/dashboard/debugger')
</script>

<template>
  <div class="mx-auto w-full max-w-4xl">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm text-[#8B93A7]">
          Templates for hardware fleets — a shared packed schema and master key for
          zero-touch registration.
        </p>
      </div>
      <NuxtLink
        v-if="canWrite"
        to="/dashboard/profiles/new"
        class="btn-primary"
      >
        New profile
      </NuxtLink>
    </div>

    <p v-if="error" class="mb-3 text-sm text-red-400">{{ error }}</p>
    <p v-else-if="loading && !profiles.length" class="mb-3 text-sm text-[#8B93A7]">
      Loading profiles…
    </p>
    <p v-else-if="!loading && !profiles.length" class="mb-3 text-sm text-[#8B93A7]">
      No profiles yet —
      <NuxtLink
        v-if="canWrite"
        to="/dashboard/profiles/new"
        class="text-[#38B6FF] hover:underline"
      >
        create one
      </NuxtLink>
      <span v-else>ask an admin to create one</span>.
    </p>

    <div v-if="profiles.length" class="space-y-3">
      <div
        v-for="profile in profiles"
        :key="profile.id"
        class="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-[#E8EAEF]">{{ profile.name }}</p>
          <p class="mt-1 font-mono text-[11px] text-[#8B93A7]">
            <span v-if="profile.device_model">{{ profile.device_model }}</span>
            <span v-if="profile.device_model && profile.firmware_version"> · </span>
            <span v-if="profile.firmware_version">fw {{ profile.firmware_version }}</span>
            <span v-if="profile.device_model || profile.firmware_version"> · </span>
            {{ profile.schema_definition.length }} fields · id={{ profile.identity_field }}
          </p>
          <p class="mt-1 font-mono text-[10px] text-[#38B6FF]">
            fleet key {{ profile.fleet_key_id }}
            <span v-if="profile.fleet_secret_preview">
              · secret …{{ profile.fleet_secret_preview }}
            </span>
          </p>
        </div>
        <button
          v-if="canWrite"
          type="button"
          class="btn-ghost shrink-0 text-xs"
          @click="provisionTarget = profile"
        >
          Bulk provision
        </button>
      </div>
    </div>

    <BulkProfileProvisioning
      v-if="provisionTarget"
      :profile="provisionTarget"
      @close="provisionTarget = null"
      @provisioned="onProvisioned"
    />
  </div>
</template>

<script setup lang="ts">
import type { DeviceProfile } from '~/types'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { canWrite } = useOrganization()
const { profiles, loading, error, fetchProfiles } = useProfiles()
const { fetchDevices } = useDevices()
const user = useSupabaseUser()

const provisionTarget = ref<DeviceProfile | null>(null)

onMounted(async () => {
  await fetchProfiles()
  openProvisionFromQuery()
})

watch(
  user,
  (u, prev) => {
    if (u && !prev) fetchProfiles().then(openProvisionFromQuery)
  },
)

watch(
  () => route.query.provision,
  () => openProvisionFromQuery(),
)

function openProvisionFromQuery() {
  const id = typeof route.query.provision === 'string' ? route.query.provision : ''
  if (!id) return
  const match = profiles.value.find((p) => p.id === id)
  if (match) provisionTarget.value = match
}

async function onProvisioned() {
  provisionTarget.value = null
  await Promise.all([fetchProfiles(), fetchDevices()])
}
</script>

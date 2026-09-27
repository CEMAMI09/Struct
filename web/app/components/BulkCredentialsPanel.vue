<template>
  <section class="rounded-lg border border-[#3d2a66] bg-[#5617fc]/5 p-4" aria-labelledby="bulk-credentials-title">
    <h4 id="bulk-credentials-title" class="text-sm font-semibold text-[#E8EAEF]">
      {{ credentials.length ? (credentialsRecovered ? 'Save recovered device credentials now' : 'Save device credentials now') : 'Device credentials unavailable' }}
    </h4>

    <template v-if="credentials.length">
      <p class="mt-2 text-xs leading-5 text-[#9AA3B2]">
        {{ credentials.length }} key IDs and API secrets are available now. Download the CSV and store it securely before closing.
        Each device uses its own secret to sign frames.
      </p>
      <p v-if="credentialsRecovered" class="mt-2 text-xs text-[#E6C27A]">
        These were recovered from a completed quote and are available only for its limited recovery window.
      </p>
      <button type="button" class="btn-primary mt-3 text-xs" @click="downloadCsv">
        Download all credentials (.csv)
      </button>
      <div class="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-2">
        <div v-for="item in visibleCredentials" :key="item.deviceId" class="rounded-md border border-white/10 p-3 text-xs">
          <p class="font-medium text-[#E8EAEF]">{{ item.name }}</p>
          <p class="mt-1 break-all font-mono text-[#9AA3B2]">Key ID: {{ item.keyId }}</p>
          <p class="mt-1 break-all font-mono text-[#E8EAEF]">API secret: {{ item.apiSecret }}</p>
        </div>
      </div>
      <button
        v-if="credentials.length > 10"
        type="button"
        class="mt-2 text-xs text-[#b79bff] hover:underline"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Show fewer' : `Show all ${credentials.length} credentials` }}
      </button>
      <label class="mt-4 flex items-start gap-2 text-sm text-[#E8EAEF]">
        <input v-model="acknowledged" type="checkbox" class="mt-1 accent-[#5617fc]" />
        <span>I saved the credentials. Recovery may be unavailable after the quote expires.</span>
      </label>
    </template>

    <div v-else class="mt-2 text-xs leading-5 text-[#E6C27A]">
      <p v-if="alreadyCompleted">This import was already completed, so its one-time API secrets are no longer available.</p>
      <p v-else>The devices were created, but no API secrets were returned.</p>
      <p class="mt-2">
        Rotate each device’s credentials on
        <NuxtLink to="/dashboard/settings?tab=api-keys" class="underline">Settings → Credentials</NuxtLink>
        before using it. A new secret will be shown once per device.
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { BulkDeviceCredential } from '~/types'

const props = defineProps<{
  credentials: BulkDeviceCredential[]
  alreadyCompleted?: boolean
  credentialsRecovered?: boolean
}>()

const acknowledged = defineModel<boolean>('acknowledged', { default: false })
const showAll = ref(false)
const visibleCredentials = computed(() => showAll.value ? props.credentials : props.credentials.slice(0, 10))

function csvCell(value: string) {
  // Spreadsheet apps can evaluate a cell that starts with a formula character.
  const safe = /^\s*[=+@-]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

function downloadCsv() {
  const rows = [
    ['device_id', 'device_name', 'key_id', 'api_secret'],
    ...props.credentials.map(item => [item.deviceId, item.name, item.keyId, item.apiSecret]),
  ]
  const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `struct-device-credentials-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

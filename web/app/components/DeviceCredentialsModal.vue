<template>
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    @click.self="onDismiss"
  >
    <div
      class="relative w-full max-w-lg rounded-xl border border-[#2A2F3A] bg-[#1A1D24] p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-creds-title"
    >
      <div class="mb-4">
        <h3 id="device-creds-title" class="text-base font-semibold text-[#E8EAEF]">
          Save device credentials
        </h3>
        <p class="mt-1 text-xs text-[#8B93A7]">
          <span v-if="deviceName">Credentials for <span class="text-[#E8EAEF]">{{ deviceName }}</span>. </span>
          The API secret is shown only once — copy or download it before closing.
        </p>
      </div>

      <div class="space-y-3">
        <div>
          <p class="label">Key ID</p>
          <div class="flex gap-2">
            <input
              class="input flex-1 font-mono text-xs text-[#38B6FF]"
              type="text"
              readonly
              :value="credentials.keyId"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <button type="button" class="btn-ghost shrink-0 text-xs" @click="copy(credentials.keyId, 'keyId')">
              {{ copied === 'keyId' ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>

        <div>
          <p class="label">API Secret</p>
          <div class="flex gap-2">
            <input
              class="input flex-1 font-mono text-xs text-[#38B6FF]"
              type="text"
              readonly
              :value="credentials.apiSecret"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <button
              type="button"
              class="btn-ghost shrink-0 text-xs"
              @click="copy(credentials.apiSecret, 'apiSecret')"
            >
              {{ copied === 'apiSecret' ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>
      </div>

      <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" class="btn-ghost text-xs" @click="copyBoth">
          {{ copied === 'both' ? 'Copied both' : 'Copy both' }}
        </button>
        <button type="button" class="btn-ghost text-xs" @click="download">
          Download .txt
        </button>
        <button type="button" class="btn-primary text-xs" @click="onDismiss">
          Done
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DeviceCredentials } from '~/types'

const props = defineProps<{
  credentials: DeviceCredentials
  deviceName?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const copied = ref('')
let copyTimer: ReturnType<typeof setTimeout> | null = null

function markCopied(which: string) {
  copied.value = which
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    if (copied.value === which) copied.value = ''
  }, 1500)
}

async function copy(text: string, which: string) {
  await navigator.clipboard.writeText(text)
  markCopied(which)
}

async function copyBoth() {
  const text = `Key ID: ${props.credentials.keyId}\nAPI Secret: ${props.credentials.apiSecret}`
  await navigator.clipboard.writeText(text)
  markCopied('both')
}

function download() {
  const name = (props.deviceName || 'device')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'device'
  const body = [
    `# Struct device credentials`,
    `# Device: ${props.deviceName || name}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Keep the API secret private. It is not shown again.`,
    '',
    `KEY_ID=${props.credentials.keyId}`,
    `API_SECRET=${props.credentials.apiSecret}`,
    '',
  ].join('\n')

  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `struct-${name}-credentials.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function onDismiss() {
  emit('close')
}

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

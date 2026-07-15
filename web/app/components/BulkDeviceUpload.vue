<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
    <div
      class="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#2A2F3A] bg-[#1A1D24] p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-upload-title"
    >
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 id="bulk-upload-title" class="text-base font-semibold text-[#E8EAEF]">
            Bulk upload devices
          </h3>
          <p class="mt-1 text-xs text-[#8B93A7]">
            Parse CSV/XLSX in your browser, confirm billing, then insert in one request.
          </p>
        </div>
        <button type="button" class="btn-ghost text-xs" @click="$emit('close')">Close</button>
      </div>

      <div class="mb-4 flex flex-wrap gap-2">
        <button type="button" class="btn-ghost text-xs" @click="downloadBulkTemplate">
          Download template
        </button>
        <label class="btn-ghost cursor-pointer text-xs">
          Choose file
          <input
            class="hidden"
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            @change="onFileInput"
          />
        </label>
      </div>

      <div
        class="mb-4 rounded-lg border border-dashed border-[#2A2F3A] bg-[#0F1115] px-4 py-8 text-center transition"
        :class="dragOver ? 'border-[#38B6FF]/60 bg-[#38B6FF]/5' : ''"
        @dragenter.prevent="dragOver = true"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <p class="text-sm text-[#E8EAEF]">
          {{ fileName || 'Drop a .csv or .xlsx file here' }}
        </p>
        <p class="mt-1 font-mono text-[10px] text-[#8B93A7]">
          Required columns: Device Name, MAC Address, Tags
        </p>
      </div>

      <p v-if="parseError" class="mb-3 text-sm text-red-400">{{ parseError }}</p>
      <ul v-if="fileErrors.length" class="mb-3 space-y-1 text-sm text-red-400">
        <li v-for="(err, i) in fileErrors" :key="i">{{ err }}</li>
      </ul>

      <div v-if="rows.length" class="mb-4">
        <div class="mb-2 flex items-center justify-between gap-2">
          <p class="font-mono text-[10px] text-[#8B93A7]">
            {{ validCount }} valid / {{ rows.length }} rows
            <span v-if="errorCount"> · {{ errorCount }} with errors</span>
          </p>
        </div>
        <div class="max-h-56 overflow-auto rounded-lg border border-[#2A2F3A]">
          <table class="w-full min-w-[520px] text-left text-xs">
            <thead class="sticky top-0 bg-[#0F1115] text-[#8B93A7]">
              <tr>
                <th class="px-2 py-2 font-mono font-normal">Row</th>
                <th class="px-2 py-2 font-mono font-normal">Name</th>
                <th class="px-2 py-2 font-mono font-normal">MAC</th>
                <th class="px-2 py-2 font-mono font-normal">Tags</th>
                <th class="px-2 py-2 font-mono font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.row"
                class="border-t border-[#2A2F3A]/80"
                :class="row.errors.length ? 'bg-red-500/5' : ''"
              >
                <td class="px-2 py-2 font-mono text-[#8B93A7]">{{ row.row }}</td>
                <td class="px-2 py-2 text-[#E8EAEF]">{{ row.name || '—' }}</td>
                <td class="px-2 py-2 font-mono text-[#38B6FF]">{{ row.macDisplay || '—' }}</td>
                <td class="px-2 py-2 font-mono text-[#8B93A7]">{{ row.tagsRaw || '—' }}</td>
                <td class="px-2 py-2">
                  <span v-if="!row.errors.length" class="text-[#38B6FF]">OK</span>
                  <span v-else class="text-red-400">{{ row.errors[0] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div
        v-if="quote"
        class="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-[#E8EAEF]"
      >
        <p class="font-medium text-amber-200">Confirm billing impact</p>
        <ul class="mt-2 space-y-1 font-mono text-xs text-[#8B93A7]">
          <li>
            Adding
            <span class="text-[#E8EAEF]">{{ quote.deviceCount }}</span>
            devices →
            <span class="text-[#E8EAEF]">{{ quote.currentDeviceCount }}</span>
            →
            <span class="text-[#E8EAEF]">{{ quote.projectedDeviceCount }}</span>
          </li>
          <li>
            Period peak paid quantity
            <span class="text-[#E8EAEF]">{{ quote.previousPeakPaidQuantity }}</span>
            →
            <span class="text-[#E8EAEF]">{{ quote.projectedPeakPaidQuantity }}</span>
            <span v-if="quote.quantityDelta">
              (+{{ quote.quantityDelta }})
            </span>
          </li>
          <li>
            Estimated month-end overage:
            <span class="text-amber-200">{{ quote.estimatedTrueUpFormatted }}</span>
          </li>
        </ul>
        <p class="mt-2 text-[11px] leading-relaxed text-[#8B93A7]">
          {{ quote.disclaimer }}
        </p>
        <label class="mt-3 flex cursor-pointer items-start gap-2 text-xs text-[#E8EAEF]">
          <input v-model="confirmed" type="checkbox" class="mt-0.5 accent-[#38B6FF]" />
          <span>
            I understand adding
            {{ quote.deviceCount }}
            devices             may add
            {{ quote.estimatedTrueUpFormatted }}
            to my next monthly true-up invoice.
          </span>
        </label>
      </div>

      <p v-if="actionError" class="mb-3 text-sm text-red-400">{{ actionError }}</p>
      <p v-if="successMessage" class="mb-3 text-sm text-[#38B6FF]">{{ successMessage }}</p>

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" class="btn-ghost" @click="$emit('close')">Cancel</button>
        <button
          v-if="!quote"
          type="button"
          class="btn-primary"
          :disabled="!canQuote || quoting"
          @click="onQuote"
        >
          {{ quoting ? 'Calculating…' : 'Check cost & continue' }}
        </button>
        <button
          v-else
          type="button"
          class="btn-primary"
          :disabled="!confirmed || importing"
          @click="onConfirm"
        >
          {{ importing ? 'Importing…' : `Confirm & import ${quote.deviceCount} devices` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BulkUploadQuote } from '~/types'
import type { ParsedBulkRow } from '#shared/bulkUpload'
import { downloadBulkTemplate, parseBulkUploadFile } from '~/utils/parseBulkUpload'

const emit = defineEmits<{
  close: []
  imported: []
}>()

const { previewBulkUpload, confirmBulkUpload } = useDevices()

const dragOver = ref(false)
const fileName = ref('')
const parseError = ref('')
const fileErrors = ref<string[]>([])
const rows = ref<ParsedBulkRow[]>([])
const validDevices = ref<{ name: string; mac_address: string; tags: Record<string, string> }[]>([])
const quote = ref<BulkUploadQuote | null>(null)
const confirmed = ref(false)
const quoting = ref(false)
const importing = ref(false)
const actionError = ref('')
const successMessage = ref('')

const validCount = computed(() => validDevices.value.length)
const errorCount = computed(() => rows.value.filter((r) => r.errors.length).length)
const canQuote = computed(
  () => validDevices.value.length > 0 && !fileErrors.value.length && errorCount.value === 0,
)

function resetQuote() {
  quote.value = null
  confirmed.value = false
  actionError.value = ''
  successMessage.value = ''
}

async function handleFile(file: File | undefined | null) {
  resetQuote()
  parseError.value = ''
  fileErrors.value = []
  rows.value = []
  validDevices.value = []
  fileName.value = file?.name || ''
  if (!file) return

  try {
    const result = await parseBulkUploadFile(file)
    fileErrors.value = result.fileErrors
    rows.value = result.rows
    validDevices.value = result.validDevices
    if (!result.fileErrors.length && !result.rows.length) {
      parseError.value = 'No device rows found in the file.'
    }
  } catch (e: any) {
    parseError.value = e?.message || 'Failed to parse file'
  }
}

function onFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  void handleFile(file)
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  void handleFile(file)
}

async function onQuote() {
  if (!canQuote.value) return
  quoting.value = true
  actionError.value = ''
  try {
    quote.value = await previewBulkUpload(validDevices.value)
    confirmed.value = false
  } catch (e: any) {
    actionError.value = e?.message || 'Failed to calculate billing impact'
    quote.value = null
  } finally {
    quoting.value = false
  }
}

async function onConfirm() {
  if (!quote.value || !confirmed.value) return
  importing.value = true
  actionError.value = ''
  successMessage.value = ''
  try {
    const result = await confirmBulkUpload(quote.value.importId)
    successMessage.value = result.alreadyCompleted
      ? `Import already completed (${result.devices.length} devices).`
      : `Imported ${result.devices.length} devices.`
    emit('imported')
    setTimeout(() => emit('close'), 900)
  } catch (e: any) {
    actionError.value = e?.message || 'Bulk import failed'
    if (e?.refreshRequired) {
      quote.value = null
      confirmed.value = false
    }
  } finally {
    importing.value = false
  }
}
</script>

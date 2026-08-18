<template>
  <div class="mx-auto w-full max-w-3xl">
    <div class="mb-6">
      <NuxtLink
        to="/dashboard/profiles"
        class="text-sm text-[#8B93A7] transition hover:text-[#E8EAEF]"
      >
        ← Profiles
      </NuxtLink>
      <p class="mt-3 text-sm text-[#8B93A7]">
        Define a master template for a hardware fleet. Submitting generates a single Master Fleet
        Key used by every unit of this type for zero-touch registration.
      </p>
    </div>

    <p v-if="!canWrite" class="mb-4 text-sm text-amber-300">
      You need owner or admin access to create profiles.
    </p>

    <form class="space-y-6" @submit.prevent="onSubmit">
      <section class="card space-y-4 p-4">
        <h3 class="text-sm font-semibold text-[#E8EAEF]">Static attributes</h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label class="label" for="profile-name">Profile name</label>
            <input
              id="profile-name"
              v-model="name"
              class="input"
              required
              maxlength="120"
              placeholder="ESP32 Temp Node v2"
              :disabled="!canWrite || saving"
            />
          </div>
          <div>
            <label class="label" for="device-model">Device model</label>
            <input
              id="device-model"
              v-model="deviceModel"
              class="input mono"
              maxlength="80"
              placeholder="ESP32-C3"
              :disabled="!canWrite || saving"
            />
          </div>
          <div>
            <label class="label" for="firmware-version">Firmware version</label>
            <input
              id="firmware-version"
              v-model="firmwareVersion"
              class="input mono"
              maxlength="40"
              placeholder="1.4.2"
              :disabled="!canWrite || saving"
            />
          </div>
        </div>
      </section>

      <section class="card p-4">
        <ProfileSchemaBuilder
          v-model="fields"
          v-model:identity-field="identityField"
          :disabled="!canWrite || saving"
          :profile-name="name || 'Fleet'"
        />
      </section>

      <div
        v-if="created"
        class="rounded-lg border border-[#38B6FF]/40 bg-[#38B6FF]/5 p-4"
      >
        <p class="text-sm font-semibold text-[#38B6FF]">Profile created</p>
        <p class="mt-1 text-xs text-[#8B93A7]">
          Flash this Master Fleet Key on every unit. Identity comes from
          <span class="font-mono text-[#E8EAEF]">{{ created.profile.identity_field }}</span>
          in the packed payload.
        </p>
        <div class="mt-3 space-y-2">
          <div>
            <div class="mb-1 flex items-center justify-between">
              <p class="label mb-0">Master Fleet Key (key_id)</p>
              <button type="button" class="btn-ghost py-1 text-[10px]" @click="copyFleetKey">
                {{ keyCopied ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <pre
              class="mono overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#0F1115] p-3 text-xs text-[#38B6FF]"
            >{{ created.credentials.fleetKeyId }}</pre>
          </div>
          <div>
            <div class="mb-1 flex items-center justify-between">
              <p class="label mb-0">Fleet API secret (shown once)</p>
              <button type="button" class="btn-ghost py-1 text-[10px]" @click="copyFleetSecret">
                {{ secretCopied ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <pre
              class="mono overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#0F1115] p-3 text-xs text-[#38B6FF]"
            >{{ created.credentials.fleetSecret }}</pre>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <NuxtLink
            :to="`/dashboard/profiles?provision=${created.profile.id}`"
            class="btn-primary"
          >
            Bulk provision devices
          </NuxtLink>
          <NuxtLink to="/dashboard/profiles" class="btn-ghost">Back to profiles</NuxtLink>
        </div>
      </div>

      <p v-if="message" class="text-sm" :class="error ? 'text-red-400' : 'text-[#38B6FF]'">
        {{ message }}
      </p>

      <div class="flex flex-wrap justify-end gap-2">
        <NuxtLink to="/dashboard/profiles" class="btn-ghost">Cancel</NuxtLink>
        <button
          type="submit"
          class="btn-primary"
          :disabled="!canWrite || saving || !!created"
        >
          {{ saving ? 'Creating…' : 'Create profile & generate fleet key' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import type { DeviceProfile, DeviceProfileCredentials, SchemaField } from '~/types'

definePageMeta({ middleware: 'auth' })

const { canWrite } = useOrganization()
const { createProfile } = useProfiles()

const name = ref('')
const deviceModel = ref('')
const firmwareVersion = ref('')
const identityField = ref('device_id')
const fields = ref<SchemaField[]>([
  { name: 'device_id', type: 'char', length: 6 },
  { name: 'battery_level', type: 'uint8' },
])
const saving = ref(false)
const message = ref('')
const error = ref(false)
const keyCopied = ref(false)
const secretCopied = ref(false)
const created = ref<{
  profile: DeviceProfile
  credentials: DeviceProfileCredentials
} | null>(null)

function cleanedFields(): SchemaField[] {
  return fields.value
    .map((f) => {
      const name = f.name.trim()
      if (f.type === 'flags') {
        return {
          name,
          type: 'flags' as const,
          bits: (f.bits || [])
            .map((b) => ({ name: String(b.name || '').trim(), bit: Number(b.bit) | 0 }))
            .filter((b) => b.name),
        }
      }
      if (f.type === 'char') {
        return {
          name,
          type: 'char' as const,
          length: Math.max(1, Math.min(64, Number(f.length) || 1)),
        }
      }
      return { name, type: f.type }
    })
    .filter((f) => f.name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name))
}

function validate(): string | null {
  const cleaned = cleanedFields()
  if (!name.value.trim()) return 'Profile name is required'
  if (!cleaned.length) return 'Add at least one valid schema field'
  if (!cleaned.some((f) => f.name === identityField.value.trim())) {
    return `Identity field "${identityField.value}" must be one of the schema fields`
  }
  for (const f of cleaned) {
    if (f.type === 'flags' && (!f.bits || !f.bits.length)) {
      return `Flags field "${f.name}" needs at least one bit`
    }
  }
  return null
}

async function onSubmit() {
  if (created.value) return
  const validationError = validate()
  if (validationError) {
    message.value = validationError
    error.value = true
    return
  }

  saving.value = true
  message.value = ''
  error.value = false
  try {
    const result = await createProfile({
      name: name.value.trim(),
      deviceModel: deviceModel.value.trim(),
      firmwareVersion: firmwareVersion.value.trim(),
      schemaDefinition: cleanedFields(),
      identityField: identityField.value.trim(),
    })
    created.value = result
    message.value = 'Master Fleet Key generated — store the secret securely.'
  } catch (e: any) {
    message.value = e?.message || 'Failed to create profile'
    error.value = true
  } finally {
    saving.value = false
  }
}

async function copyFleetKey() {
  if (!created.value) return
  await navigator.clipboard.writeText(created.value.credentials.fleetKeyId)
  keyCopied.value = true
  setTimeout(() => {
    keyCopied.value = false
  }, 1500)
}

async function copyFleetSecret() {
  if (!created.value) return
  await navigator.clipboard.writeText(created.value.credentials.fleetSecret)
  secretCopied.value = true
  setTimeout(() => {
    secretCopied.value = false
  }, 1500)
}
</script>

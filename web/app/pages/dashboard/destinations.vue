<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <h2 class="text-lg font-semibold text-[#E8EAEF]">Destinations</h2>
        <p class="text-sm text-[#8B93A7]">
          Route parsed packets to your own systems, optionally using a payload rule.
        </p>
      </div>
      <button
        v-if="canWrite"
        class="btn-primary w-full shrink-0 sm:w-auto"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Cancel' : 'Add Destination' }}
      </button>
    </div>

    <form
      v-if="showForm && canWrite"
      class="card mb-6 space-y-4 p-4"
      @submit.prevent="onCreate"
    >
      <div>
        <label class="label">Name</label>
        <input v-model="form.name" class="input" placeholder="AWS API / Plant webhook" required />
      </div>
      <div>
        <label class="label">Webhook URL</label>
        <input
          v-model="form.url"
          class="input mono"
          type="url"
          placeholder="https://hooks.example.com/struct"
          required
        />
      </div>
      <div>
        <label class="label">Scope</label>
        <select v-model="form.device_id" class="input">
          <option value="">All devices</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <div class="rounded-lg border border-[#2A2F3A] p-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-[#E8EAEF]">
          <input
            v-model="form.routingEnabled"
            type="checkbox"
            :disabled="!canUseRouting"
          />
          Only send when a payload rule matches
        </label>
        <p v-if="!canUseRouting" class="mt-2 text-xs text-amber-300">
          Logical routing requires Scale.
          <NuxtLink to="/dashboard/settings" class="underline">View plans</NuxtLink>
        </p>
        <div
          v-if="form.routingEnabled"
          class="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr]"
        >
          <div>
            <label class="label">Key</label>
            <input
              v-model="form.routingKey"
              class="input mono"
              placeholder="temperature"
              :required="form.routingEnabled"
            />
          </div>
          <div>
            <label class="label">Operator</label>
            <select v-model="form.routingOperator" class="input mono">
              <option v-for="operator in routingOperators" :key="operator" :value="operator">
                {{ operator }}
              </option>
            </select>
          </div>
          <div>
            <label class="label">Value</label>
            <input
              v-model="form.routingValue"
              class="input mono"
              placeholder="100"
              :required="form.routingEnabled"
            />
          </div>
        </div>
        <p v-if="form.routingEnabled" class="mt-2 text-xs text-[#8B93A7]">
          Example: temperature &gt; 100. Missing payload keys do not match.
        </p>
      </div>
      <button type="submit" class="btn-primary" :disabled="creating">
        {{ creating ? 'Saving…' : 'Create destination' }}
      </button>
    </form>

    <p v-if="error" class="mb-4 text-sm text-red-400">{{ error }}</p>

    <div class="card divide-y divide-[#2A2F3A]">
      <div v-if="!destinations.length" class="p-8 text-center text-sm text-[#8B93A7]">
        No destinations yet. Add a URL and every parsed JSON packet will POST there instantly.
      </div>

      <div
        v-for="dest in destinations"
        :key="dest.id"
        class="p-4"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span
                class="h-2 w-2 rounded-full"
                :class="dest.enabled ? 'bg-[#38B6FF]' : 'bg-[#8B93A7]'"
              />
              <p class="font-medium text-[#E8EAEF]">{{ dest.name }}</p>
            </div>
            <p class="mt-1 break-all font-mono text-xs text-[#8B93A7]">{{ dest.url }}</p>
            <p class="mt-1 text-[10px] text-[#8B93A7]">
              {{ dest.device_id ? deviceName(dest.device_id) : 'All devices' }}
            </p>
            <p v-if="dest.routing_rule" class="mt-1 font-mono text-[10px] text-[#38B6FF]">
              When {{ dest.routing_rule.key }} {{ dest.routing_rule.operator }}
              {{ formatRuleValue(dest.routing_rule.value) }}
            </p>
          </div>
          <div v-if="canWrite" class="flex shrink-0 gap-2">
            <button
              v-if="canUseRouting || dest.routing_rule"
              class="btn-ghost text-xs"
              @click="startRuleEdit(dest)"
            >
              {{ editingId === dest.id ? 'Cancel' : 'Edit rule' }}
            </button>
            <button class="btn-ghost text-xs" @click="onToggle(dest)">
              {{ dest.enabled ? 'Disable' : 'Enable' }}
            </button>
            <button
              class="btn-ghost text-xs text-red-400 hover:border-red-400/40"
              @click="onDelete(dest.id)"
            >
              Delete
            </button>
          </div>
        </div>

        <form
          v-if="editingId === dest.id"
          class="mt-4 rounded-lg border border-[#2A2F3A] p-3"
          @submit.prevent="saveRule(dest.id)"
        >
          <label class="flex cursor-pointer items-center gap-2 text-sm text-[#E8EAEF]">
            <input
              v-model="editForm.enabled"
              type="checkbox"
              :disabled="!canUseRouting && !editForm.enabled"
            />
            Only send when a payload rule matches
          </label>
          <div
            v-if="editForm.enabled"
            class="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr]"
          >
            <input
              v-model="editForm.key"
              class="input mono"
              placeholder="Key"
              :disabled="!canUseRouting"
              required
            />
            <select v-model="editForm.operator" class="input mono" :disabled="!canUseRouting">
              <option v-for="operator in routingOperators" :key="operator" :value="operator">
                {{ operator }}
              </option>
            </select>
            <input
              v-model="editForm.value"
              class="input mono"
              placeholder="Value"
              :disabled="!canUseRouting"
              required
            />
          </div>
          <div class="mt-3 flex gap-2">
            <button
              class="btn-primary text-xs"
              type="submit"
              :disabled="savingRule || (editForm.enabled && !canUseRouting)"
            >
              {{ savingRule ? 'Saving…' : 'Save rule' }}
            </button>
            <button
              v-if="dest.routing_rule"
              class="btn-ghost text-xs text-red-400"
              type="button"
              :disabled="savingRule"
              @click="removeRule(dest.id)"
            >
              Remove rule
            </button>
          </div>
        </form>
      </div>
    </div>

    <div class="card mt-6 p-4">
      <p class="label">Webhook body</p>
      <pre class="mono overflow-x-auto rounded-lg bg-[#0F1115] p-3 text-xs leading-relaxed text-[#38B6FF]">{{ webhookExample }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

import type { Destination, RoutingOperator, RoutingRule } from '~/types'

const { devices, fetchDevices } = useDevices()
const { canWrite } = useOrganization()
const { hasEntitlement } = useEntitlements()
const canUseRouting = computed(() => hasEntitlement('logical_routing'))
const {
  destinations,
  error,
  fetchDestinations,
  createDestination,
  toggleDestination,
  updateDestinationRoutingRule,
  deleteDestination,
} = useDestinations()

const showForm = ref(false)
const creating = ref(false)
const editingId = ref<string | null>(null)
const savingRule = ref(false)
const routingOperators: RoutingOperator[] = ['>', '>=', '<', '<=', '==', '!=']
const form = reactive({
  name: '',
  url: '',
  device_id: '',
  routingEnabled: false,
  routingKey: '',
  routingOperator: '>' as RoutingOperator,
  routingValue: '',
})
const editForm = reactive({
  enabled: false,
  key: '',
  operator: '>' as RoutingOperator,
  value: '',
})

const webhookExample = `{
  "device_id": "…",
  "device_name": "ESP32 Chicago",
  "timestamp": "2026-07-14T18:00:00.000Z",
  "payload": { "temp": 72.5, "humidity": 45.2 }
}`

onMounted(async () => {
  await Promise.all([fetchDevices(), fetchDestinations()])
})

function deviceName(id: string) {
  return devices.value.find((d) => d.id === id)?.name || id.slice(0, 8)
}

function parseRuleValue(value: string): string | number | boolean {
  const trimmed = value.trim()
  if (trimmed.toLowerCase() === 'true') return true
  if (trimmed.toLowerCase() === 'false') return false
  const numeric = Number(trimmed)
  return trimmed !== '' && Number.isFinite(numeric) ? numeric : trimmed
}

function formatRuleValue(value: RoutingRule['value']) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function startRuleEdit(destination: Destination) {
  if (editingId.value === destination.id) {
    editingId.value = null
    return
  }

  editingId.value = destination.id
  editForm.enabled = !!destination.routing_rule
  editForm.key = destination.routing_rule?.key || ''
  editForm.operator = destination.routing_rule?.operator || '>'
  editForm.value =
    destination.routing_rule == null ? '' : String(destination.routing_rule.value)
}

async function saveRule(id: string) {
  savingRule.value = true
  error.value = null
  try {
    const routingRule: RoutingRule | null = editForm.enabled
      ? {
          key: editForm.key.trim(),
          operator: editForm.operator,
          value: parseRuleValue(editForm.value),
        }
      : null
    await updateDestinationRoutingRule(id, routingRule)
    editingId.value = null
  } catch (e: any) {
    error.value = e.message
  } finally {
    savingRule.value = false
  }
}

async function removeRule(id: string) {
  savingRule.value = true
  error.value = null
  try {
    await updateDestinationRoutingRule(id, null)
    editingId.value = null
  } catch (e: any) {
    error.value = e.message
  } finally {
    savingRule.value = false
  }
}

async function onCreate() {
  creating.value = true
  try {
    const routingRule: RoutingRule | null = form.routingEnabled
      ? {
          key: form.routingKey.trim(),
          operator: form.routingOperator,
          value: parseRuleValue(form.routingValue),
        }
      : null

    await createDestination({
      name: form.name.trim(),
      url: form.url.trim(),
      device_id: form.device_id || null,
      routing_rule: routingRule,
    })
    form.name = ''
    form.url = ''
    form.device_id = ''
    form.routingEnabled = false
    form.routingKey = ''
    form.routingOperator = '>'
    form.routingValue = ''
    showForm.value = false
  } catch (e: any) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}

async function onToggle(dest: { id: string; enabled: boolean }) {
  try {
    await toggleDestination(dest.id, !dest.enabled)
  } catch (e: any) {
    error.value = e.message
  }
}

async function onDelete(id: string) {
  if (!confirm('Remove this destination?')) return
  try {
    await deleteDestination(id)
  } catch (e: any) {
    error.value = e.message
  }
}
</script>

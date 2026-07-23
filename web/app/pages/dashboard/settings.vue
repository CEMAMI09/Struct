<template>
  <div class="mx-auto max-w-5xl">
    <div class="mb-6">
      <h2 class="text-lg font-semibold text-[#E8EAEF]">Settings</h2>
      <p class="text-sm text-[#8B93A7]">Manage billing, credentials, routing, and your account.</p>
    </div>

    <div class="mb-6 overflow-x-auto border-b border-[#2A2F3A]">
      <div class="flex min-w-max gap-1">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          class="border-b-2 px-4 py-3 text-sm transition"
          :class="
            activeTab === item.id
              ? 'border-[#38B6FF] text-[#E8EAEF]'
              : 'border-transparent text-[#8B93A7] hover:text-[#E8EAEF]'
          "
          @click="activeTab = item.id"
        >
          {{ item.name }}
        </button>
      </div>
    </div>

    <p v-if="pageError || billingError || destinationError" class="mb-4 text-sm text-red-400">
      {{ pageError || billingError || destinationError }}
    </p>
    <p v-if="pageMsg" class="mb-4 text-sm text-[#38B6FF]">{{ pageMsg }}</p>

    <DeviceCredentialsModal
      v-if="pendingCredentials"
      :credentials="pendingCredentials"
      :device-name="pendingCredentialsName"
      @close="clearPendingCredentials"
    />

    <!-- Billing -->
    <section v-if="activeTab === 'billing'" class="space-y-4">
      <div class="card p-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="label">Current tier</p>
            <p class="mt-1 text-xl font-semibold capitalize text-[#E8EAEF]">
              {{ currentOrganization?.subscription_tier || 'free' }}
            </p>
            <p class="mt-1 text-sm text-[#E8EAEF]">
              {{ deviceLimit }} device limit
            </p>
            <p class="mt-1 text-xs text-[#8B93A7]">
              5 free + {{ usagePeakPaid || currentOrganization?.stripe_quantity || 0 }} paid peak this period
            </p>
          </div>
          <div class="flex shrink-0 flex-col gap-2 sm:items-end">
            <button
              v-if="canWrite"
              type="button"
              class="btn-primary"
              :disabled="billingLoading"
              @click="onManageBilling"
            >
              {{ billingLoading ? 'Opening…' : 'Manage billing' }}
            </button>
            <button
              v-if="canWrite && currentOrganization?.stripe_customer_id"
              type="button"
              class="btn-ghost text-xs"
              :disabled="billingLoading"
              @click="onSyncBilling"
            >
              Refresh
            </button>
          </div>
        </div>

        <div class="mt-6">
          <div class="mb-2 flex justify-between text-xs">
            <span class="text-[#8B93A7]">Device usage</span>
            <span class="font-mono text-[#E8EAEF]">{{ devices.length }} / {{ deviceLimit }}</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-[#0F1115]">
            <div
              class="h-full rounded-full bg-[#38B6FF] transition-all"
              :style="{ width: `${usagePercent}%` }"
            />
          </div>
          <p class="mt-2 text-[11px] text-[#8B93A7]">
            {{ Math.max(0, deviceLimit - devices.length) }} device slots remaining.
          </p>
        </div>
      </div>

      <div v-if="canWrite && showUpgradePlans" class="space-y-3">
        <div>
          <p class="label">Upgrade plan</p>
          <p class="text-xs text-[#8B93A7]">
            Choose a paid plan to unlock more devices and features.
          </p>
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <article
            v-for="plan in upgradePlans"
            :key="plan.id"
            class="card flex flex-col p-4"
          >
            <div class="flex items-start justify-between gap-2">
              <h3 class="font-semibold text-[#E8EAEF]">{{ plan.name }}</h3>
              <span class="shrink-0 font-mono text-sm text-[#38B6FF]">{{ plan.price }}</span>
            </div>
            <p class="mt-1 text-xs text-[#8B93A7]">{{ plan.blurb }}</p>
            <button
              type="button"
              class="btn-primary mt-4 w-full text-xs"
              :disabled="billingLoading"
              @click="onUpgrade(plan.id)"
            >
              {{ billingLoading ? 'Redirecting…' : `Choose ${plan.name}` }}
            </button>
          </article>
        </div>
      </div>
    </section>

    <!-- API Keys -->
    <section v-else-if="activeTab === 'api-keys'" class="space-y-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="label">Device authentication</p>
          <p class="text-xs text-[#8B93A7]">Each token authenticates one device connection.</p>
        </div>
        <button v-if="canWrite" type="button" class="btn-primary" @click="showTokenForm = !showTokenForm">
          Generate New Token
        </button>
      </div>

      <form
        v-if="showTokenForm"
        class="card flex flex-col gap-3 p-4 sm:flex-row"
        @submit.prevent="onRotateToken"
      >
        <select v-model="tokenDeviceId" class="input flex-1" required>
          <option value="" disabled>Select a device to rotate its token</option>
          <option v-for="device in devices" :key="device.id" :value="device.id">
            {{ device.name }}
          </option>
        </select>
        <button class="btn-primary shrink-0" type="submit" :disabled="rotatingToken">
          {{ rotatingToken ? 'Generating…' : 'Generate' }}
        </button>
      </form>

      <div class="card overflow-hidden">
        <div v-if="!devices.length" class="p-8 text-center text-sm text-[#8B93A7]">
          No device tokens yet.
        </div>
        <div
          v-for="device in devices"
          v-else
          :key="device.id"
          class="flex flex-col gap-3 border-b border-[#2A2F3A] p-4 last:border-b-0 sm:flex-row sm:items-center"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-[#E8EAEF]">{{ device.name }}</p>
            <p class="mt-1 font-mono text-xs text-[#8B93A7]">
              {{ revealedKeys.has(device.id) ? device.api_key : maskToken(device.api_key) }}
            </p>
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost text-xs" @click="toggleKey(device.id)">
              {{ revealedKeys.has(device.id) ? 'Hide' : 'Reveal' }}
            </button>
            <button
              v-if="canWrite"
              type="button"
              class="btn-ghost text-xs text-red-400"
              title="Delete device and revoke token"
              @click="onRevokeToken(device.id, device.name)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
      <p class="text-[11px] text-[#8B93A7]">
        Generating replaces the selected device’s token immediately. Delete revokes the token by
        deleting its device.
      </p>
    </section>

    <!-- Webhooks -->
    <section v-else-if="activeTab === 'webhooks'" class="space-y-4">
      <form v-if="canWrite" class="card space-y-4 p-5" @submit.prevent="onCreateWebhook">
        <div>
          <label class="label" for="webhook-url">Endpoint URL</label>
          <input
            id="webhook-url"
            v-model="webhookUrl"
            class="input font-mono"
            type="url"
            placeholder="https://api.example.com/struct/events"
            required
          />
        </div>
        <div>
          <p class="label">Event types</p>
          <div class="mt-2 grid gap-2 sm:grid-cols-3">
            <label
              v-for="event in webhookEvents"
              :key="event.id"
              class="flex cursor-pointer items-center gap-2 rounded-lg border border-[#2A2F3A] px-3 py-2 text-xs text-[#E8EAEF]"
            >
              <input v-model="selectedEvents" type="checkbox" :value="event.id" />
              {{ event.name }}
            </label>
          </div>
        </div>
        <button class="btn-primary" type="submit" :disabled="creatingWebhook || !selectedEvents.length">
          {{ creatingWebhook ? 'Adding…' : 'Add webhook' }}
        </button>
      </form>

      <div class="card divide-y divide-[#2A2F3A]">
        <div v-if="!destinations.length" class="p-8 text-center text-sm text-[#8B93A7]">
          No webhook endpoints configured.
        </div>
        <div v-for="destination in destinations" :key="destination.id" class="p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <p class="break-all font-mono text-xs text-[#E8EAEF]">{{ destination.url }}</p>
              <p class="mt-2 text-[11px] text-[#8B93A7]">
                {{ (destination.event_types || ['telemetry.received']).join(' · ') }}
              </p>
              <p class="mt-2 break-all font-mono text-[11px] text-[#8B93A7]">
                Secret:
                {{
                  revealedSecrets.has(destination.id)
                    ? destination.signing_secret
                    : maskSecret(destination.signing_secret)
                }}
              </p>
            </div>
            <div class="flex gap-2">
              <button
                v-if="canWrite"
                type="button"
                class="btn-ghost text-xs"
                @click="toggleSecret(destination.id)"
              >
                {{ revealedSecrets.has(destination.id) ? 'Hide secret' : 'View secret' }}
              </button>
              <button
                v-if="canWrite"
                type="button"
                class="btn-ghost text-xs text-red-400"
                @click="onDeleteWebhook(destination.id)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
      <p class="text-[11px] text-[#8B93A7]">
        Verify <span class="font-mono">x-struct-signature</span> as HMAC-SHA256 of the exact request
        body using this secret.
      </p>
    </section>

    <!-- Account -->
    <section v-else class="space-y-4">
      <div class="card p-5">
        <p class="label">Password reset</p>
        <p class="mt-1 text-xs text-[#8B93A7]">
          Set a new password for {{ user?.email }}.
        </p>
        <form class="mt-4 max-w-md space-y-3" @submit.prevent="onResetPassword">
          <input
            v-model="newPassword"
            class="input"
            type="password"
            minlength="8"
            autocomplete="new-password"
            placeholder="New password (8+ characters)"
            required
          />
          <input
            v-model="confirmPassword"
            class="input"
            type="password"
            minlength="8"
            autocomplete="new-password"
            placeholder="Confirm new password"
            required
          />
          <button class="btn-primary" type="submit" :disabled="resettingPassword">
            {{ resettingPassword ? 'Updating…' : 'Update password' }}
          </button>
        </form>
      </div>

      <div class="card divide-y divide-[#2A2F3A]">
        <label class="flex cursor-pointer items-center justify-between gap-4 p-4">
          <span>
            <span class="block text-sm text-[#E8EAEF]">Billing notifications</span>
            <span class="text-xs text-[#8B93A7]">Plan, payment, and device-limit updates.</span>
          </span>
          <input v-model="notifications.billing" type="checkbox" class="accent-[#38B6FF]" />
        </label>
        <label class="flex cursor-pointer items-center justify-between gap-4 p-4">
          <span>
            <span class="block text-sm text-[#E8EAEF]">Fleet alerts</span>
            <span class="text-xs text-[#8B93A7]">Device connectivity and delivery failures.</span>
          </span>
          <input v-model="notifications.fleet" type="checkbox" class="accent-[#38B6FF]" />
        </label>
        <label class="flex cursor-pointer items-center justify-between gap-4 p-4">
          <span>
            <span class="block text-sm text-[#E8EAEF]">Product updates</span>
            <span class="text-xs text-[#8B93A7]">Occasional Struct feature announcements.</span>
          </span>
          <input v-model="notifications.product" type="checkbox" class="accent-[#38B6FF]" />
        </label>
      </div>
      <button type="button" class="btn-primary" :disabled="savingNotifications" @click="saveNotifications">
        {{ savingNotifications ? 'Saving…' : 'Save notification settings' }}
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

import type { DeviceCredentials, SubscriptionTier, WebhookEventType } from '~/types'

type SettingsTab = 'billing' | 'api-keys' | 'webhooks' | 'account'
type PaidTier = Exclude<SubscriptionTier, 'free'>

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const {
  devices,
  fetchDevices,
  deleteDevice,
  rotateDeviceApiKey,
} = useDevices()
const {
  currentOrganization,
  canWrite,
  deviceLimit,
  usagePeakPaid,
  ensureOrganization,
  fetchMemberships,
  fetchUsageStats,
} = useOrganization()
const {
  destinations,
  error: destinationError,
  fetchDestinations,
  createDestination,
  deleteDestination,
} = useDestinations()
const {
  loading: billingLoading,
  error: billingError,
  startCheckout,
  openPortal,
  syncCheckout,
  syncFromStripe,
} = useBilling()

const upgradePlans: { id: PaidTier; name: string; price: string; blurb: string }[] = [
  {
    id: 'flexible',
    name: 'Flexible',
    price: '$5/mo',
    blurb: '10-device start · +$1.00 / device',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$49/mo',
    blurb: '155-device start · encryption & downlinks',
  },
  {
    id: 'scale',
    name: 'Scale',
    price: '$249/mo',
    blurb: '1,005-device start · RBAC & audit logs',
  },
]

const hasPaidSubscription = computed(
  () => !!currentOrganization.value?.stripe_subscription_id,
)
const showUpgradePlans = ref(false)

const tabs: { id: SettingsTab; name: string }[] = [
  { id: 'billing', name: 'Billing' },
  { id: 'api-keys', name: 'API Keys' },
  { id: 'webhooks', name: 'Webhooks' },
  { id: 'account', name: 'Account' },
]
const activeTab = ref<SettingsTab>('billing')
const pendingCredentials = ref<DeviceCredentials | null>(null)
const pendingCredentialsName = ref('')
const pageError = ref('')
const pageMsg = ref('')
const usagePercent = computed(() =>
  Math.min(100, Math.round((devices.value.length / Math.max(1, deviceLimit.value)) * 100)),
)

const showTokenForm = ref(false)
const tokenDeviceId = ref('')
const rotatingToken = ref(false)
const revealedKeys = ref(new Set<string>())

const webhookUrl = ref('')
const selectedEvents = ref<WebhookEventType[]>(['telemetry.received'])
const creatingWebhook = ref(false)
const revealedSecrets = ref(new Set<string>())
const webhookEvents: { id: WebhookEventType; name: string }[] = [
  { id: 'telemetry.received', name: 'Telemetry received' },
  { id: 'device.connected', name: 'Device connected' },
  { id: 'device.disconnected', name: 'Device disconnected' },
]

const resettingPassword = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')
const savingNotifications = ref(false)
const notifications = reactive({
  billing: true,
  fleet: true,
  product: false,
})

onMounted(async () => {
  try {
    await ensureOrganization()
    await Promise.all([fetchDevices(), fetchDestinations()])

    showUpgradePlans.value = !currentOrganization.value?.stripe_subscription_id

    // Pull live Stripe quantity (portal increases often aren't in local DB yet).
    if (currentOrganization.value?.stripe_customer_id) {
      await syncFromStripe()
    }
    await fetchUsageStats()

    const saved = user.value?.user_metadata?.notifications
    if (saved && typeof saved === 'object') {
      notifications.billing = saved.billing ?? true
      notifications.fleet = saved.fleet ?? true
      notifications.product = saved.product ?? false
    }

    if (route.query.billing === 'success') {
      const sessionId =
        typeof route.query.session_id === 'string' ? route.query.session_id : ''
      if (sessionId) await syncCheckout(sessionId)
      await syncFromStripe()
      await fetchMemberships()
      showUpgradePlans.value = !currentOrganization.value?.stripe_subscription_id
      pageMsg.value = 'Subscription updated.'
    } else if (route.query.billing === 'cancel') {
      pageMsg.value = 'Checkout was canceled.'
    }
  } catch (error: any) {
    pageError.value = error?.data?.message || error?.message || 'Failed to load settings'
  }
})

function setMessage(message = '', error = '') {
  pageMsg.value = message
  pageError.value = error
}

async function onManageBilling() {
  setMessage()
  if (!hasPaidSubscription.value) {
    showUpgradePlans.value = true
    pageMsg.value = 'Choose a plan below to upgrade.'
    return
  }
  try {
    await openPortal()
  } catch (error: any) {
    pageError.value = error?.data?.message || error.message
  }
}

async function onUpgrade(tier: PaidTier) {
  setMessage()
  try {
    await startCheckout(tier)
  } catch (error: any) {
    pageError.value = error?.data?.message || error.message
  }
}

async function onSyncBilling() {
  setMessage()
  try {
    const result = await syncFromStripe()
    if (result?.synced) {
      pageMsg.value = `Synced from Stripe: ${result.deviceLimit} device limit (${result.stripeQuantity} paid slots).`
    } else if (result) {
      pageMsg.value = 'No active Stripe subscription found to sync.'
    } else {
      pageError.value = 'Could not sync billing from Stripe.'
    }
  } catch (error: any) {
    pageError.value = error?.data?.message || error.message
  }
}

function maskToken(token: string) {
  return token.length > 8 ? `${token.slice(0, 4)}••••••••${token.slice(-4)}` : '••••••••'
}

function maskSecret(secret?: string) {
  if (!secret) return 'Migration 017 required'
  return `${secret.slice(0, 6)}${'•'.repeat(18)}${secret.slice(-4)}`
}

function toggleSet(setRef: Ref<Set<string>>, id: string) {
  const next = new Set(setRef.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setRef.value = next
}

function toggleKey(id: string) {
  toggleSet(revealedKeys, id)
}

function toggleSecret(id: string) {
  toggleSet(revealedSecrets, id)
}

function clearPendingCredentials() {
  pendingCredentials.value = null
  pendingCredentialsName.value = ''
}

async function onRotateToken() {
  if (!tokenDeviceId.value) return
  rotatingToken.value = true
  setMessage()
  try {
    const result = await rotateDeviceApiKey(tokenDeviceId.value)
    const device = result.device
    const next = new Set(revealedKeys.value)
    next.add(device.id)
    revealedKeys.value = next
    showTokenForm.value = false
    if (result.credentials) {
      pendingCredentialsName.value = device.name
      pendingCredentials.value = result.credentials
      pageMsg.value = `New credentials for ${device.name}. Save the API secret now — it won’t be shown again.`
    } else {
      pageMsg.value = `Generated a new token for ${device.name}.`
    }
  } catch (error: any) {
    pageError.value = error.message
  } finally {
    rotatingToken.value = false
  }
}

async function onRevokeToken(id: string, name: string) {
  if (!confirm(`Delete “${name}” and permanently revoke its token?`)) return
  setMessage()
  try {
    await deleteDevice(id)
    pageMsg.value = 'Device token revoked.'
  } catch (error: any) {
    pageError.value = error.message
  }
}

async function onCreateWebhook() {
  creatingWebhook.value = true
  setMessage()
  try {
    const url = new URL(webhookUrl.value)
    await createDestination({
      name: url.hostname,
      url: url.toString(),
      event_types: selectedEvents.value,
    })
    webhookUrl.value = ''
    selectedEvents.value = ['telemetry.received']
    pageMsg.value = 'Webhook endpoint added.'
  } catch (error: any) {
    pageError.value = error.message
  } finally {
    creatingWebhook.value = false
  }
}

async function onDeleteWebhook(id: string) {
  if (!confirm('Delete this webhook endpoint?')) return
  setMessage()
  try {
    await deleteDestination(id)
    pageMsg.value = 'Webhook deleted.'
  } catch (error: any) {
    pageError.value = error.message
  }
}

async function onResetPassword() {
  if (newPassword.value.length < 8) {
    pageError.value = 'Password must be at least 8 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    pageError.value = 'Passwords do not match.'
    return
  }
  resettingPassword.value = true
  setMessage()
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword.value })
    if (error) throw error
    newPassword.value = ''
    confirmPassword.value = ''
    pageMsg.value = 'Password updated.'
  } catch (error: any) {
    pageError.value = error.message
  } finally {
    resettingPassword.value = false
  }
}

async function saveNotifications() {
  savingNotifications.value = true
  setMessage()
  try {
    const { error } = await supabase.auth.updateUser({
      data: { notifications: { ...notifications } },
    })
    if (error) throw error
    pageMsg.value = 'Notification settings saved.'
  } catch (error: any) {
    pageError.value = error.message
  } finally {
    savingNotifications.value = false
  }
}
</script>

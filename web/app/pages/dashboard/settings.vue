<template>
  <div class="mx-auto max-w-5xl">
    <div class="mb-6">
      <p class="text-sm text-[#8B93A7]">Billing, credentials, routing, account preferences, and support.</p>
    </div>

      <div class="mb-6 overflow-x-auto border-b border-[#2A2F3A]">
      <div class="flex min-w-max gap-1" role="tablist" aria-label="Settings">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          class="border-b-2 px-4 py-3 text-sm transition"
          role="tab"
          :aria-selected="activeTab === item.id"
          :class="
            activeTab === item.id
              ? 'border-[#E8EAEF] text-[#E8EAEF]'
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
    <p v-if="pageMsg" class="mb-4 text-sm text-[#b79bff]">{{ pageMsg }}</p>



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
              v-if="canWrite"
              type="button"
              class="btn-ghost text-xs"
              :disabled="billingSyncing || billingLoading" @click="onSyncBilling"
            >
              {{billingSyncing?'Refreshing…':'Refresh billing'}}
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
              class="h-full rounded-full bg-[#5617fc] transition-all"
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
              <span class="shrink-0 font-mono text-sm text-[#b79bff]">{{ plan.price }}</span>
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

    <section v-else-if="activeTab === 'api-keys'" class="space-y-4"><h2 class="font-semibold">Secure V2 device credentials</h2><p class="text-sm text-[#9AA3B2]">Private credentials are included only in explicit starter exports. Rotate in device setup after secret exposure or counter-state loss. One credential belongs to one sender.</p><div v-for="device in devices" :key="device.id" class="card flex flex-wrap items-center justify-between gap-3 p-4"><span>{{device.name}}</span><NuxtLink :to="`/dashboard/schema?device=${device.id}`" class="btn-ghost text-xs">Manage device credentials</NuxtLink></div><NuxtLink to="/docs/devices" class="text-[#b79bff]">Credential and rotation guide</NuxtLink></section>

    <!-- Webhooks -->
    <section v-else-if="activeTab === 'webhooks'" class="space-y-4">
      <div class="card p-5">
        <h2 class="text-sm font-semibold">Destinations are the webhook configuration</h2>
        <p class="mt-2 text-sm text-[#9AA3B2]">
          Create endpoints, choose events, set device scope, edit routing, and view signing secrets on Destinations.
          Delivery attempts are on the Deliveries page.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <NuxtLink to="/dashboard/destinations" class="btn-primary text-xs">Open destinations</NuxtLink>
          <NuxtLink to="/dashboard/deliveries" class="btn-ghost text-xs">Open deliveries</NuxtLink>
        </div>
      </div>
      <div class="card divide-y divide-[#2A2F3A]">
        <div v-if="!destinations.length" class="p-6 text-sm text-[#9AA3B2]">
          No webhook endpoints configured.
        </div>
        <div v-for="destination in destinations" :key="destination.id" class="p-4">
          <p class="text-sm text-[#E8EAEF]">{{ destination.name }}</p>
          <p class="mt-1 text-xs text-[#9AA3B2]">Endpoint URL hidden. Owners and admins can reveal it on Destinations.</p>
        </div>
      </div>
    </section>

    <!-- Appearance -->
    <section v-else-if="activeTab === 'appearance'" class="space-y-4">
      <div class="card p-5">
        <p class="label">Color mode</p>
        <p class="mt-1 text-xs text-[#8B93A7]">
          Dark or light. Saved in this browser and used across the site.
        </p>
        <div class="mt-4 grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Color mode">
          <button
            type="button"
            role="radio"
            class="rounded-xl border px-4 py-4 text-left transition"
            :aria-checked="mode === 'dark'"
            :class="mode === 'dark' ? 'border-[#5617fc] bg-[#5617fc]/10' : 'border-[#2A2F3A]'"
            @click="setMode('dark')"
          >
            <span class="block text-sm font-semibold text-[#E8EAEF]">Dark</span>
            <span class="mt-1 block text-xs text-[#8B93A7]">Black surfaces and light text</span>
          </button>
          <button
            type="button"
            role="radio"
            class="rounded-xl border px-4 py-4 text-left transition"
            :aria-checked="mode === 'light'"
            :class="mode === 'light' ? 'border-[#5617fc] bg-[#5617fc]/10' : 'border-[#2A2F3A]'"
            @click="setMode('light')"
          >
            <span class="block text-sm font-semibold text-[#E8EAEF]">Light</span>
            <span class="mt-1 block text-xs text-[#8B93A7]">White surfaces and dark text</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Support -->
    <section v-else-if="activeTab === 'support'" class="space-y-4">
      <div class="card p-5">
        <p class="label">Contact support</p>
        <p class="mt-2 text-sm text-[#9AA3B2]">
          Contact support at
          <a
            href="mailto:support@usestruct.com"
            class="text-[#E8EAEF] underline decoration-[#5617fc] underline-offset-2"
          >support@usestruct.com</a>.
        </p>
      </div>
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

    </section>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

import type { SubscriptionTier } from '~/types'

type SettingsTab = 'billing' | 'api-keys' | 'webhooks' | 'account' | 'appearance' | 'support'
type PaidTier = Exclude<SubscriptionTier, 'free'>

const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const {
  devices,
  fetchDevices,
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
} = useDestinations()
const {
  syncing: billingSyncing,
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
    blurb: '155-device start · 30-day retention & downlinks',
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

const { mode, setMode } = useTheme()

const tabs: { id: SettingsTab; name: string }[] = [
  { id: 'billing', name: 'Billing' },
  { id: 'api-keys', name: 'Credentials' },
  { id: 'webhooks', name: 'Webhooks' },
  { id: 'account', name: 'Account' },
  { id: 'appearance', name: 'Appearance' },
  { id: 'support', name: 'Support' },
]
const activeTab = ref<SettingsTab>('billing')

watch(() => route.query.tab, (tab) => {
  if (typeof tab === 'string' && tabs.some(item => item.id === tab)) {
    activeTab.value = tab as SettingsTab
  }
}, { immediate: true })
const pageError = ref('')
const pageMsg = ref('')
const usagePercent = computed(() =>
  Math.min(100, Math.round((devices.value.length / Math.max(1, deviceLimit.value)) * 100)),
)


const resettingPassword = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')

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
  if(billingSyncing.value)return
  setMessage()
  try {
    const result = await syncFromStripe()
    if (result?.synced) {
      pageMsg.value = 'Billing information is up to date.'
    } else if (result) {
      pageMsg.value = result.subscriptionTier==='free'?"You’re currently using the Free plan.":'Billing information is up to date.'
    } else {
      pageError.value = 'Unable to refresh billing information. Please try again.'
    }
  } catch (error: any) {
    pageError.value = error?.data?.message || error.message
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

</script>

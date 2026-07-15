<template>
  <div class="mx-auto max-w-5xl">
    <div class="mb-6">
      <h2 class="text-lg font-semibold text-[#E8EAEF]">Settings</h2>
      <p class="text-sm text-[#8B93A7]">
        Manage your subscription, device allowance, and plan capabilities.
      </p>
    </div>

    <p v-if="pageError || billingError" class="mb-4 text-sm text-red-400">
      {{ pageError || billingError }}
    </p>
    <p v-if="pageMsg" class="mb-4 text-sm text-[#38B6FF]">{{ pageMsg }}</p>

    <section class="card mb-6 p-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="label">Current subscription</p>
          <p class="mt-1 text-lg font-semibold capitalize text-[#E8EAEF]">
            {{ currentOrganization?.subscription_tier || 'free' }}
          </p>
          <p class="mt-1 text-sm text-[#8B93A7]">
            {{ devices.length }} active devices · {{ deviceLimit }} device limit
          </p>
          <p class="mt-1 font-mono text-[10px] text-[#8B93A7]">
            5 free + {{ currentOrganization?.stripe_quantity ?? 0 }} paid
          </p>
        </div>
        <button
          v-if="canWrite && currentOrganization?.stripe_customer_id"
          type="button"
          class="btn-ghost shrink-0 text-xs"
          :disabled="billingLoading"
          @click="onOpenPortal"
        >
          {{ billingLoading ? 'Opening…' : 'Manage billing' }}
        </button>
      </div>
    </section>

    <section>
      <div class="mb-3">
        <p class="label">Plans</p>
        <p class="text-xs text-[#8B93A7]">
          Paid device quantities scale automatically when you exceed your plan’s included pool.
        </p>
      </div>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="plan in plans"
          :key="plan.id"
          class="card flex flex-col p-5"
          :class="
            currentOrganization?.subscription_tier === plan.id
              ? 'border-[#38B6FF]/60 bg-[#38B6FF]/5'
              : ''
          "
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold text-[#E8EAEF]">{{ plan.name }}</h3>
              <p class="mt-1 text-xs text-[#8B93A7]">{{ plan.subtitle }}</p>
            </div>
            <span class="shrink-0 font-mono text-sm text-[#38B6FF]">{{ plan.price }}</span>
          </div>

          <p class="mt-4 font-mono text-xs text-[#E8EAEF]">{{ plan.devices }}</p>
          <p class="mt-1 text-xs text-[#8B93A7]">{{ plan.overage }}</p>

          <ul class="mt-4 flex-1 space-y-2 text-xs text-[#8B93A7]">
            <li v-for="feature in plan.features" :key="feature" class="flex gap-2">
              <span class="text-[#38B6FF]">✓</span>
              <span>{{ feature }}</span>
            </li>
          </ul>

          <p
            v-if="currentOrganization?.subscription_tier === plan.id"
            class="mt-5 text-xs text-[#38B6FF]"
          >
            Current plan
          </p>
          <button
            v-else-if="plan.checkoutTier && canWrite"
            type="button"
            class="btn-primary mt-5 w-full text-xs"
            :disabled="billingLoading"
            @click="onUpgrade(plan.checkoutTier)"
          >
            {{ billingLoading ? 'Redirecting…' : `Choose ${plan.name}` }}
          </button>
          <a
            v-else-if="plan.id === 'enterprise'"
            href="mailto:sales@struct.dev?subject=Struct Enterprise"
            class="btn-primary mt-5 block w-full text-center text-xs"
          >
            Contact sales
          </a>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { SubscriptionTier } from '~/types'

type PaidTier = Exclude<SubscriptionTier, 'free'>

interface PricingPlan {
  id: SubscriptionTier | 'enterprise'
  checkoutTier?: PaidTier
  name: string
  subtitle: string
  price: string
  devices: string
  overage: string
  features: string[]
}

const route = useRoute()
const { devices, fetchDevices } = useDevices()
const {
  currentOrganization,
  canWrite,
  deviceLimit,
  ensureOrganization,
  fetchMemberships,
} = useOrganization()
const { loading: billingLoading, error: billingError, startCheckout, openPortal } =
  useBilling()

const pageError = ref('')
const pageMsg = ref('')

const plans: PricingPlan[] = [
  {
    id: 'free',
    name: 'Developer',
    subtitle: 'Build and validate your first fleet.',
    price: '$0',
    devices: 'Up to 5 devices',
    overage: 'Hard cap — upgrade to add more devices.',
    features: [
      'Standard dashboard',
      'Basic webhooks',
      'Live debugger',
      '24-hour telemetry retention',
    ],
  },
  {
    id: 'flexible',
    checkoutTier: 'flexible',
    name: 'Flexible Scale',
    subtitle: 'Start small and scale one device at a time.',
    price: '$5/mo',
    devices: '10-device starting allowance',
    overage: '+$1.00 per device / month',
    features: [
      'Everything in Developer',
      'Automatic device scaling',
      '7-day telemetry retention',
    ],
  },
  {
    id: 'pro',
    checkoutTier: 'pro',
    name: 'Pro',
    subtitle: 'Bulk pricing and secure device operations.',
    price: '$49/mo',
    devices: '155-device starting allowance',
    overage: '+$0.50 per device / month',
    features: [
      'Everything in Flexible Scale',
      'ChaCha20 encryption',
      'Device downlinks',
      '30-day telemetry retention',
    ],
  },
  {
    id: 'scale',
    checkoutTier: 'scale',
    name: 'Scale',
    subtitle: 'Governance and routing for large fleets.',
    price: '$249/mo',
    devices: '1,005-device starting allowance',
    overage: '+$0.20 per device / month',
    features: [
      'Everything in Pro',
      'Team RBAC',
      'Immutable audit logs',
      'Webhook logical routing',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    subtitle: 'Custom infrastructure and commercial terms.',
    price: 'Custom',
    devices: 'Custom device allowance',
    overage: 'Custom incremental pricing',
    features: [
      'Everything in Scale',
      'SAML SSO',
      'Dedicated L4 ingestion ports',
      'Custom SLAs',
    ],
  },
]

onMounted(async () => {
  await ensureOrganization()
  await fetchDevices()

  if (route.query.billing === 'success') {
    await fetchMemberships()
    pageMsg.value = 'Subscription updated. Your new capabilities are now available.'
  } else if (route.query.billing === 'cancel') {
    pageMsg.value = 'Checkout was canceled. Your subscription was not changed.'
  }
})

async function onUpgrade(tier: PaidTier) {
  pageError.value = ''
  pageMsg.value = ''
  try {
    await startCheckout(tier)
  } catch (error: any) {
    pageError.value = error?.data?.message || error.message
  }
}

async function onOpenPortal() {
  pageError.value = ''
  pageMsg.value = ''
  try {
    await openPortal()
  } catch (error: any) {
    pageError.value = error?.data?.message || error.message
  }
}
</script>

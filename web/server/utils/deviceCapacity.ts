import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getDeviceLimit,
  getRequiredQuantity,
  isPaidTier,
  type OrganizationBillingRow,
} from './billing'
import {
  countOrganizationDevices,
  getOrganizationBilling,
} from './organizations'
import { useStripeClient } from './stripe'

export interface CapacityPlan {
  org: OrganizationBillingRow
  currentCount: number
  projectedCount: number
  currentLimit: number
  previousQuantity: number
  targetQuantity: number
  quantityDelta: number
  needsStripeUpdate: boolean
}

export function planCapacityForProjectedCount(
  org: OrganizationBillingRow,
  currentCount: number,
  newDeviceCount: number,
): CapacityPlan {
  const projectedCount = currentCount + newDeviceCount
  const currentLimit = getDeviceLimit(org.stripe_quantity)
  const previousQuantity = org.stripe_quantity
  const requiredQuantity = getRequiredQuantity(org.subscription_tier, projectedCount)
  const targetQuantity = Math.max(previousQuantity, requiredQuantity)
  const quantityDelta = targetQuantity - previousQuantity

  return {
    org,
    currentCount,
    projectedCount,
    currentLimit,
    previousQuantity,
    targetQuantity,
    quantityDelta,
    needsStripeUpdate: quantityDelta > 0,
  }
}

export async function resolveCapacityPlan(
  supabase: SupabaseClient,
  orgId: string,
  newDeviceCount: number,
) {
  const org = await getOrganizationBilling(supabase, orgId)
  const currentCount = await countOrganizationDevices(supabase, orgId)
  const plan = planCapacityForProjectedCount(org, currentCount, newDeviceCount)

  if (plan.projectedCount <= plan.currentLimit) {
    return plan
  }

  if (!isPaidTier(org.subscription_tier)) {
    throw createError({
      statusCode: 402,
      statusMessage: 'Payment Required',
      message: `Free tier supports up to 5 devices. This upload would reach ${plan.projectedCount}. Upgrade to add more.`,
    })
  }

  if (!org.stripe_item_id || !org.stripe_subscription_id || !org.stripe_customer_id) {
    throw createError({
      statusCode: 402,
      statusMessage: 'Payment Required',
      message:
        'Paid plan is missing Stripe billing details. Open Billing settings to fix your plan.',
    })
  }

  return plan
}

export async function applyStripeQuantity(
  org: OrganizationBillingRow,
  targetQuantity: number,
  idempotencyKey: string,
) {
  if (!org.stripe_item_id) {
    throw createError({
      statusCode: 402,
      message: 'Paid plan is missing a Stripe subscription item.',
    })
  }

  if (targetQuantity <= org.stripe_quantity) {
    return org.stripe_quantity
  }

  const stripe = useStripeClient()
  await stripe.subscriptionItems.update(
    org.stripe_item_id,
    {
      quantity: targetQuantity,
      proration_behavior: 'create_prorations',
    },
    { idempotencyKey },
  )

  return targetQuantity
}

export async function restoreStripeQuantity(
  org: OrganizationBillingRow,
  previousQuantity: number,
  idempotencyKey: string,
) {
  if (!org.stripe_item_id) return

  const stripe = useStripeClient()
  await stripe.subscriptionItems.update(
    org.stripe_item_id,
    {
      quantity: previousQuantity,
      proration_behavior: 'create_prorations',
    },
    { idempotencyKey: `${idempotencyKey}:restore` },
  )
}

export async function estimateProrationCents(
  org: OrganizationBillingRow,
  targetQuantity: number,
): Promise<{ amount: number; currency: string }> {
  if (
    !org.stripe_customer_id ||
    !org.stripe_subscription_id ||
    !org.stripe_item_id ||
    targetQuantity <= org.stripe_quantity
  ) {
    return { amount: 0, currency: 'usd' }
  }

  const stripe = useStripeClient()
  const preview = await stripe.invoices.createPreview({
    customer: org.stripe_customer_id,
    subscription: org.stripe_subscription_id,
    subscription_details: {
      items: [
        {
          id: org.stripe_item_id,
          quantity: targetQuantity,
        },
      ],
      proration_behavior: 'create_prorations',
    },
  })

  const currency = preview.currency || 'usd'
  const prorationCents = (preview.lines?.data || [])
    .filter((line) => line.parent?.subscription_item_details?.proration || (line as any).proration)
    .reduce((sum, line) => sum + (line.amount || 0), 0)

  // Prefer explicit proration lines; fall back to amount_due when Stripe omits them.
  const amount = Math.max(0, prorationCents || preview.amount_due || 0)
  return { amount, currency }
}

export async function persistStripeQuantity(
  supabase: SupabaseClient,
  orgId: string,
  quantity: number,
) {
  const { error } = await supabase
    .from('organizations')
    .update({ stripe_quantity: quantity })
    .eq('id', orgId)

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
}

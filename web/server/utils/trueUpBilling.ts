import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TIER_FLOORS, type PaidTier, type SubscriptionTier } from './billing'
import { estimateTrueUpCents } from './usagePeriods'
import { useStripeClient } from './stripe'

const OVERAGE_PRICE_CENTS: Record<PaidTier, number> = {
  flexible: 100,
  pro: 50,
  scale: 20,
}

export async function processPeriodTrueUp(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: Date,
) {
  const periodStartIso = periodStart.toISOString()
  const { data: period, error } = await supabase
    .from('organization_device_usage_periods')
    .select('*')
    .eq('organization_id', orgId)
    .eq('stripe_period_start', periodStartIso)
    .eq('status', 'open')
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
  if (!period) return null

  if (new Date(period.stripe_period_end) > new Date()) {
    return null
  }

  const tier = period.tier as SubscriptionTier
  if (tier === 'free') {
    await supabase
      .from('organization_device_usage_periods')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('id', period.id)
    return null
  }

  const included = period.included_paid_quantity ?? TIER_FLOORS[tier]
  const overageQty = Math.max(0, period.peak_paid_quantity - included)
  const amountCents = estimateTrueUpCents(tier, included, period.peak_paid_quantity)

  if (overageQty <= 0 || amountCents <= 0) {
    await supabase
      .from('organization_device_usage_periods')
      .update({
        status: 'invoiced',
        true_up_amount_cents: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', period.id)
    return { amountCents: 0, overageQty: 0 }
  }

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('id', orgId)
    .maybeSingle()

  if (orgError) {
    throw createError({ statusCode: 500, message: orgError.message })
  }
  if (!org?.stripe_customer_id) {
    throw createError({ statusCode: 402, message: 'Missing Stripe customer for true-up billing' })
  }

  const stripe = useStripeClient()
  const rate = OVERAGE_PRICE_CENTS[tier as PaidTier]
  const invoiceItem = await stripe.invoiceItems.create({
    customer: org.stripe_customer_id,
    amount: amountCents,
    currency: 'usd',
    description: `Struct device overage (${overageQty} devices @ $${(rate / 100).toFixed(2)}/device)`,
    metadata: {
      orgId,
      usagePeriodId: period.id,
      peakPaidQuantity: String(period.peak_paid_quantity),
      includedPaidQuantity: String(included),
    },
  })

  await supabase
    .from('organization_device_usage_periods')
    .update({
      status: 'invoiced',
      true_up_amount_cents: amountCents,
      true_up_invoice_item_id: invoiceItem.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', period.id)

  return { amountCents, overageQty, invoiceItemId: invoiceItem.id }
}

export async function syncUsagePeriodFromSubscription(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  orgId: string,
) {
  const periodStart = new Date(subscription.current_period_start * 1000)
  const periodEnd = new Date(subscription.current_period_end * 1000)

  const { data: org } = await supabase
    .from('organizations')
    .select('subscription_tier')
    .eq('id', orgId)
    .maybeSingle()

  if (!org) return

  const tier = org.subscription_tier as SubscriptionTier
  const included = TIER_FLOORS[tier]

  await supabase.from('organization_device_usage_periods').upsert(
    {
      organization_id: orgId,
      stripe_subscription_id: subscription.id,
      stripe_period_start: periodStart.toISOString(),
      stripe_period_end: periodEnd.toISOString(),
      tier,
      included_paid_quantity: included,
      status: 'open',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,stripe_period_start' },
  )

  const now = new Date()
  if (periodEnd <= now) {
    await processPeriodTrueUp(supabase, orgId, periodStart)
  }
}

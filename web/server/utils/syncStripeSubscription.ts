import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type PaidTier,
  type SubscriptionTier,
} from './billing'

function tierForPrice(
  priceId: string | undefined,
  prices: { flexible: string; pro: string; scale: string },
): PaidTier | null {
  if (!priceId) return null
  if (priceId === prices.flexible) return 'flexible'
  if (priceId === prices.pro) return 'pro'
  if (priceId === prices.scale) return 'scale'
  return null
}

/** A verified Checkout may adopt a subscription for an unlinked organization.
 * Once linked, only that subscription may update its entitlements. */
export async function applyStripeSubscriptionToOrg(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  prices: { flexible: string; pro: string; scale: string },
  orgIdHint?: string | null,
  allowCheckoutAdoption = false,
) {
  if (orgIdHint && subscription.metadata?.orgId && subscription.metadata.orgId !== orgIdHint) {
    throw createError({ statusCode: 500, message: 'Subscription belongs to another organization' })
  }
  const orgId = orgIdHint || subscription.metadata?.orgId || null
  const items = subscription.items.data.filter((candidate) => tierForPrice(candidate.price.id, prices))
  if (items.length !== 1) {
    throw createError({ statusCode: 500, message: 'Subscription must have exactly one configured Struct price' })
  }
  const item = items[0]!

  const liveQuantity = item.quantity ?? 0

  let existingQuery = supabase
    .from('organizations')
    .select('id, stripe_customer_id, stripe_subscription_id, stripe_quantity, subscription_tier')
  if (orgId) {
    existingQuery = existingQuery.eq('id', orgId)
  } else {
    existingQuery = existingQuery.eq('stripe_subscription_id', subscription.id)
  }
  const { data: existing, error: existingError } = await existingQuery.maybeSingle()
  if (existingError) {
    throw createError({ statusCode: 500, message: existingError.message })
  }
  if (!existing) return null

  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id || null
  if (existing.stripe_customer_id && customerId !== existing.stripe_customer_id) {
    throw createError({ statusCode: 500, message: 'Subscription customer does not match organization' })
  }

  // A checkout.session.completed event can precede payment for delayed
  // methods. Never grant a new or upgraded tier on an unsettled subscription.
  if (subscription.status === 'incomplete') return null
  if (existing.stripe_subscription_id && existing.stripe_subscription_id !== subscription.id) return null
  if (!existing.stripe_subscription_id && !allowCheckoutAdoption) return null

  // In dunning, Stripe can show a new price before an invoice is paid. Keep
  // the previous entitlement until the subscription returns to active.
  if (subscription.status === 'past_due') return null
  if (subscription.status === 'unpaid' || subscription.status === 'paused') {
    // Keep the subscription link so a later successful payment can restore it.
    // Do not grant device capacity or paid-only features while unpaid.
    const { error } = await supabase.from('organizations').update({
      subscription_tier: 'free',
      stripe_quantity: 0,
    }).eq('id', existing.id).eq('stripe_subscription_id', subscription.id)
    if (error) throw createError({ statusCode: 500, message: error.message })
    return { orgId: existing.id, subscriptionTier: 'free' as const, stripeQuantity: 0, deviceLimit: 5 }
  }

  if (subscription.status !== 'active' && subscription.status !== 'trialing' &&
      subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired') return null

  const patch: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
    stripe_item_id: item.id,
    // Always trust Stripe's live quantity on the winning subscription.
    stripe_quantity: liveQuantity,
  }

  const tier =
    tierForPrice(item.price.id, prices)

  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    patch.subscription_tier = 'free'
    patch.stripe_subscription_id = null
    patch.stripe_item_id = null
    patch.stripe_quantity = 0
  } else if (tier) {
    patch.subscription_tier = tier
  }

  let query = supabase.from('organizations').update(patch).eq('id', existing.id)
  query = existing.stripe_subscription_id
    ? query.eq('stripe_subscription_id', existing.stripe_subscription_id)
    : query.is('stripe_subscription_id', null)

  const { data: updated, error } = await query.select('id').maybeSingle()
  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
  if (!updated) return null // Another checkout or webhook won the race.

  return {
    orgId: orgId || existing?.id || null,
    subscriptionTier: (patch.subscription_tier as SubscriptionTier | undefined) || null,
    stripeQuantity: Number(patch.stripe_quantity) || 0,
    deviceLimit: 5 + (Number(patch.stripe_quantity) || 0),
  }
}


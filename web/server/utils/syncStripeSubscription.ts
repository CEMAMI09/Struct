import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type PaidTier,
  type SubscriptionTier,
} from './billing'

const PAID_TIERS = new Set<PaidTier>(['flexible', 'pro', 'scale'])

function parseTier(value: string | null | undefined): SubscriptionTier | null {
  if (!value) return null
  if (value === 'free') return 'free'
  if (PAID_TIERS.has(value as PaidTier)) return value as PaidTier
  return null
}

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

function subscriptionQuantity(subscription: Stripe.Subscription) {
  return subscription.items.data.reduce((sum, item) => sum + (item.quantity ?? 0), 0)
}

/**
 * Apply a live Stripe subscription onto the matching organization.
 * Never lets a lower-quantity sibling (stacked checkout orphan) overwrite a
 * healthier subscription on the same org.
 */
export async function applyStripeSubscriptionToOrg(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  prices: { flexible: string; pro: string; scale: string },
  orgIdHint?: string | null,
) {
  const orgId = orgIdHint || subscription.metadata?.orgId || null
  const item = subscription.items.data[0]
  if (!item) {
    return null
  }

  const liveQuantity = subscriptionQuantity(subscription)

  let existingQuery = supabase
    .from('organizations')
    .select('id, stripe_subscription_id, stripe_quantity, subscription_tier')
  if (orgId) {
    existingQuery = existingQuery.eq('id', orgId)
  } else {
    existingQuery = existingQuery.eq('stripe_subscription_id', subscription.id)
  }
  const { data: existing } = await existingQuery.maybeSingle()

  if (
    existing?.stripe_subscription_id &&
    existing.stripe_subscription_id !== subscription.id
  ) {
    // Event is for a different subscription on this org (usually an orphan).
    // Only take over when this one is clearly better; never shrink capacity.
    if (
      subscription.status === 'canceled' ||
      subscription.status === 'incomplete_expired'
    ) {
      return null
    }
    if (liveQuantity < (existing.stripe_quantity ?? 0)) {
      return null
    }
  }

  const patch: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    stripe_customer_id:
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id || null,
    stripe_item_id: item.id,
    // Always trust Stripe's live quantity on the winning subscription.
    stripe_quantity: liveQuantity,
  }

  const tier =
    tierForPrice(item.price.id, prices) ||
    parseTier(subscription.metadata?.targetTier) ||
    parseTier(subscription.metadata?.tier)

  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    patch.subscription_tier = 'free'
    patch.stripe_subscription_id = null
    patch.stripe_item_id = null
    patch.stripe_quantity = 0
  } else if (tier && tier !== 'free') {
    patch.subscription_tier = tier
  }

  let query = supabase.from('organizations').update(patch)
  if (orgId) {
    query = query.eq('id', orgId)
  } else if (existing?.id) {
    query = query.eq('id', existing.id)
  } else {
    query = query.eq('stripe_subscription_id', subscription.id)
  }

  const { error } = await query
  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }

  return {
    orgId: orgId || existing?.id || null,
    subscriptionTier: (patch.subscription_tier as SubscriptionTier | undefined) || null,
    stripeQuantity: Number(patch.stripe_quantity) || 0,
    deviceLimit: 5 + (Number(patch.stripe_quantity) || 0),
  }
}

/** Pick the active subscription with the highest billed quantity. */
export function pickBestSubscription(subscriptions: Stripe.Subscription[]) {
  if (!subscriptions.length) return null
  return [...subscriptions].sort((a, b) => {
    const qa = subscriptionQuantity(a)
    const qb = subscriptionQuantity(b)
    if (qb !== qa) return qb - qa
    return b.created - a.created
  })[0]!
}

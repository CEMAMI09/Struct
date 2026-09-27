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

/** Apply only the subscription linked to the organization, unless a verified
 * Checkout explicitly replaces it. A larger sibling is not automatically the
 * customer's intended plan. */
export async function applyStripeSubscriptionToOrg(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  prices: { flexible: string; pro: string; scale: string },
  orgIdHint?: string | null,
  allowReplacement = false,
) {
  if (orgIdHint && subscription.metadata?.orgId && subscription.metadata.orgId !== orgIdHint) {
    throw createError({ statusCode: 500, message: 'Subscription belongs to another organization' })
  }
  const orgId = orgIdHint || subscription.metadata?.orgId || null
  const item = subscription.items.data.find((candidate) => tierForPrice(candidate.price.id, prices))
  if (!item) {
    throw createError({ statusCode: 500, message: 'Subscription has no configured Struct price' })
  }

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

  if (
    existing?.stripe_subscription_id &&
    existing.stripe_subscription_id !== subscription.id
  ) {
    // Only an explicitly completed Checkout can replace the linked
    // subscription. Unrelated events must never choose a plan by quantity.
    if (!allowReplacement) return null
    if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
      return null
    }
  }

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


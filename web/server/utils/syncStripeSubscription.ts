import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SubscriptionTier } from './billing'
import { tierForStripePrice } from './stripePriceContract'

/** Low-level commit: callers must retrieve Stripe while holding this token's
 * organization guard. The database fences workers whose read lease expired. */
export async function applyStripeSubscriptionToOrg(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  prices: { flexible: string; pro: string; scale: string },
  orgIdHint?: string | null,
  allowCheckoutAdoption = false,
  billingToken?: string,
) {
  if (!billingToken) throw createError({ statusCode: 500, message: 'Billing synchronization requires a guard' })
  if (orgIdHint && subscription.metadata?.orgId && subscription.metadata.orgId !== orgIdHint) {
    throw createError({ statusCode: 500, message: 'Subscription belongs to another organization' })
  }
  const orgId = orgIdHint || subscription.metadata?.orgId || null
  let existingQuery = supabase.from('organizations')
    .select('id, stripe_customer_id, stripe_subscription_id, stripe_item_id, stripe_quantity, subscription_tier')
  existingQuery = orgId
    ? existingQuery.eq('id', orgId)
    : existingQuery.eq('stripe_subscription_id', subscription.id)
  const { data: existing, error: existingError } = await existingQuery.maybeSingle()
  if (existingError) throw createError({ statusCode: 500, message: existingError.message })
  if (!existing) return null
  if (existing.stripe_subscription_id && existing.stripe_subscription_id !== subscription.id) return null
  if (!existing.stripe_subscription_id && !allowCheckoutAdoption) return null

  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer : subscription.customer?.id || null
  if (existing.stripe_customer_id && customerId !== existing.stripe_customer_id) {
    throw createError({ statusCode: 500, message: 'Subscription customer does not match organization' })
  }
  if (subscription.status === 'incomplete' || subscription.status === 'past_due') return null
  if (!existing.stripe_subscription_id && subscription.status !== 'active' && subscription.status !== 'trialing') return null

  const terminal = subscription.status === 'canceled' || subscription.status === 'incomplete_expired'
  let tier: SubscriptionTier
  let quantity: number
  let itemId: string | null
  if (terminal || subscription.status === 'unpaid' || subscription.status === 'paused') {
    // Revoke the exact linked subscription even if its price is retired or its
    // items changed. Cancellation never requires a recognized current price.
    tier = 'free'
    quantity = 0
    itemId = terminal ? null : existing.stripe_item_id || null
  } else {
    if (subscription.status !== 'active' && subscription.status !== 'trialing') return null
    const items = subscription.items.data.filter(item => tierForStripePrice(item.price.id, prices))
    if (items.length !== 1) throw createError({ statusCode: 500, message: 'Subscription must have exactly one configured Struct price' })
    const item = items[0]!
    tier = tierForStripePrice(item.price.id, prices)!
    quantity = item.quantity ?? 0
    itemId = item.id
  }
  const { data: committed, error } = await supabase.rpc('apply_org_billing_state', {
    p_org_id: existing.id, p_claim_token: billingToken,
    p_expected_subscription_id: existing.stripe_subscription_id,
    p_subscription_id: terminal ? null : subscription.id,
    p_customer_id: customerId || existing.stripe_customer_id,
    p_item_id: itemId, p_tier: tier, p_quantity: quantity,
  })
  if (error) throw createError({ statusCode: 500, message: error.message })
  if (!committed) return null
  return { orgId: existing.id, subscriptionTier: tier, stripeQuantity: quantity, deviceLimit: 5 + quantity }
}

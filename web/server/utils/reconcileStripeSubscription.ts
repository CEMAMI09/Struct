import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyStripeSubscriptionToOrg } from './syncStripeSubscription'
import { withOrgBillingLock } from './stripeBillingLock'

export async function reconcileStripeSubscription(
  supabase: SupabaseClient,
  stripe: Stripe,
  subscriptionId: string,
  prices: { flexible: string; pro: string; scale: string },
  orgIdHint?: string | null,
  allowCheckoutAdoption = false,
) {
  let orgId = orgIdHint
  if (!orgId) {
    const { data, error } = await supabase.from('organizations')
      .select('id').eq('stripe_subscription_id', subscriptionId).maybeSingle()
    if (error) throw createError({ statusCode: 500, message: error.message })
    orgId = data?.id
  }
  // This Stripe account also serves other products. Ignore unlinked events.
  if (!orgId) return null
  return withOrgBillingLock(supabase, orgId, async (guard) => {
    const current = await stripe.subscriptions.retrieve(subscriptionId)
    return applyStripeSubscriptionToOrg(supabase, current, prices, orgId, allowCheckoutAdoption, guard.token)
  })
}

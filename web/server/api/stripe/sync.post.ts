import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import { getOrganizationBilling } from '../../utils/organizations'
import { useStripeClient } from '../../utils/stripe'
import { reconcileStripeSubscription } from '../../utils/reconcileStripeSubscription'
import { resolveStripePriceIds } from '../../utils/stripePriceContract'

/**
 * Pull live Stripe subscription quantity/tier into organizations.
 * Needed because portal quantity changes may land before webhooks (or when
 * stripe listen isn't running locally).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ orgId?: string }>(event)
  const orgId = body?.orgId?.trim()

  if (!orgId) {
    throw createError({ statusCode: 400, message: 'orgId is required' })
  }

  await requireOrgWriter(event, orgId)

  const serviceSupabase = await serverSupabaseServiceRole(event)
  const org = await getOrganizationBilling(serviceSupabase, orgId)

  if (!org.stripe_subscription_id && !org.stripe_customer_id) {
    return {
      ok: true,
      subscriptionTier: org.subscription_tier,
      stripeQuantity: org.stripe_quantity,
      deviceLimit: 5 + org.stripe_quantity,
      synced: false,
    }
  }

  const stripe = useStripeClient()
  const config = useRuntimeConfig()
  const prices = resolveStripePriceIds(config)

  const subscriptionId = org.stripe_subscription_id

  if (!subscriptionId) {
    return {
      ok: true,
      subscriptionTier: org.subscription_tier,
      stripeQuantity: org.stripe_quantity,
      deviceLimit: 5 + org.stripe_quantity,
      synced: false,
    }
  }

  const result = await reconcileStripeSubscription(
    serviceSupabase,
    stripe,
    subscriptionId,
    prices,
    orgId,
  )

  return {
    ok: true,
    synced: true,
    subscriptionTier: result?.subscriptionTier || org.subscription_tier,
    stripeQuantity: result?.stripeQuantity ?? org.stripe_quantity,
    deviceLimit: result?.deviceLimit ?? 5 + org.stripe_quantity,
  }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import { getOrganizationBilling } from '../../utils/organizations'
import { useStripeClient } from '../../utils/stripe'
import {
  applyStripeSubscriptionToOrg,
  pickBestSubscription,
} from '../../utils/syncStripeSubscription'

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
  const prices = {
    flexible: config.stripePriceFlexible,
    pro: config.stripePricePro,
    scale: config.stripePriceScale,
  }

  let subscriptionId = org.stripe_subscription_id

  // Prefer the active subscription with the highest quantity for this customer.
  if (org.stripe_customer_id) {
    const list = await stripe.subscriptions.list({
      customer: org.stripe_customer_id,
      status: 'active',
      limit: 20,
    })
    const best = pickBestSubscription(list.data)
    if (best) {
      subscriptionId = best.id

      // Cancel lower-quantity duplicates left over from stacked checkouts.
      await Promise.all(
        list.data
          .filter((sub) => sub.id !== best.id)
          .map((sub) =>
            stripe.subscriptions.cancel(sub.id, { prorate: true }).catch((err: any) => {
              console.error(
                `[stripe sync] failed to cancel orphan ${sub.id}:`,
                err?.message || err,
              )
            }),
          ),
      )
    }
  }

  if (!subscriptionId) {
    return {
      ok: true,
      subscriptionTier: org.subscription_tier,
      stripeQuantity: org.stripe_quantity,
      deviceLimit: 5 + org.stripe_quantity,
      synced: false,
    }
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const result = await applyStripeSubscriptionToOrg(
    serviceSupabase,
    subscription,
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

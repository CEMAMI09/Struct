import { serverSupabaseServiceRole } from '#supabase/server'
import {
  getPriceIdForTier,
  getRequiredQuantity,
  TIER_CHECKOUT_QUANTITY,
  type PaidTier,
  type SubscriptionTier,
} from '../../utils/billing'
import { requireOrgWriter } from '../../utils/auth'
import {
  countOrganizationDevices,
  getOrganizationBilling,
} from '../../utils/organizations'
import { useStripeClient } from '../../utils/stripe'
import { applyStripeSubscriptionToOrg } from '../../utils/syncStripeSubscription'
import { assertStripePriceMatchesPlan } from '../../utils/stripePriceContract'

const PAID_TIERS: PaidTier[] = ['flexible', 'pro', 'scale']

export default defineEventHandler(async (event) => {
  const body = await readBody<{ orgId?: string; targetTier?: SubscriptionTier }>(event)
  const orgId = body?.orgId?.trim()
  const targetTier = body?.targetTier

  if (!orgId || !targetTier) {
    throw createError({ statusCode: 400, message: 'orgId and targetTier are required' })
  }

  if (!PAID_TIERS.includes(targetTier as PaidTier)) {
    throw createError({
      statusCode: 400,
      message: 'targetTier must be flexible, pro, or scale',
    })
  }

  await requireOrgWriter(event, orgId)

  const config = useRuntimeConfig()
  const prices = {
    flexible: config.stripePriceFlexible,
    pro: config.stripePricePro,
    scale: config.stripePriceScale,
  }
  const priceId = getPriceIdForTier(targetTier as PaidTier, prices)

  if (!priceId) {
    throw createError({
      statusCode: 500,
      message: 'Stripe price IDs are not configured',
    })
  }

  const serviceSupabase = await serverSupabaseServiceRole(event)
  let org = await getOrganizationBilling(serviceSupabase, orgId)
  const stripe = useStripeClient()
  await assertStripePriceMatchesPlan(stripe, targetTier as PaidTier, priceId)
  const origin = getRequestURL(event).origin
  const deviceCount = await countOrganizationDevices(serviceSupabase, orgId)
  const targetQuantity = getRequiredQuantity(targetTier, deviceCount)

  // Already subscribed: swap price on the existing subscription instead of
  // opening a second Checkout session (which left Flexible + Scale both active).
  if (org.stripe_subscription_id) {
    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    const subscriptionCustomer = typeof subscription.customer === 'string'
      ? subscription.customer : subscription.customer?.id || null
    if (!org.stripe_customer_id || subscriptionCustomer !== org.stripe_customer_id) {
      throw createError({ statusCode: 409, message: 'Billing customer mismatch. Contact support.' })
    }
    if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
      // Clear a stale ended subscription before opening a new Checkout. A
      // completed session must never replace an active linked subscription.
      await applyStripeSubscriptionToOrg(serviceSupabase, subscription, prices, orgId)
      org = await getOrganizationBilling(serviceSupabase, orgId)
      if (org.stripe_subscription_id) {
        throw createError({ statusCode: 409, message: 'Billing is being synchronized. Please retry.' })
      }
    } else {
      if (subscription.status !== 'active') {
        throw createError({ statusCode: 409, message: 'Resolve the subscription payment in Manage billing before changing plans.' })
      }
      if (!org.stripe_item_id) {
        throw createError({ statusCode: 409, message: 'Billing needs to be synchronized before changing plans.' })
      }
      if (org.subscription_tier === targetTier) {
        throw createError({ statusCode: 400, message: `Already on the ${targetTier} plan.` })
      }
      const currentItem = subscription.items.data.find((item) => item.id === org.stripe_item_id)
      if (!currentItem) {
        throw createError({ statusCode: 409, message: 'Billing item mismatch. Synchronize billing and retry.' })
      }
      const currentTier = PAID_TIERS.find((tier) => prices[tier] === currentItem.price.id)
      if (!currentTier) {
        throw createError({ statusCode: 409, message: 'Billing price mismatch. Contact support.' })
      }
      if (PAID_TIERS.indexOf(targetTier as PaidTier) < PAID_TIERS.indexOf(currentTier)) {
        throw createError({
          statusCode: 409,
          message: 'Plan downgrades need a reviewed device quantity and price. Contact support before changing tiers.',
        })
      }
      if (targetTier === currentTier) {
        throw createError({ statusCode: 409, message: 'Billing needs to be synchronized before changing plans.' })
      }
      // Keep the paid quantity on upgrades. Downgrades require a reviewed quote
      // because carrying this quantity into a higher unit price is surprising.
      const upgradeQuantity = Math.max(
        targetQuantity,
        TIER_CHECKOUT_QUANTITY[targetTier as PaidTier],
        currentItem.quantity ?? 0,
      )
      const updated = await stripe.subscriptions.update(org.stripe_subscription_id, {
        items: [
          {
            id: org.stripe_item_id,
            price: priceId,
            quantity: upgradeQuantity,
          },
        ],
        // Collect an upgrade charge now. If the card declines or requires
        // customer action, Stripe leaves the old plan in force and we do not
        // grant the new capacity in Supabase.
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        metadata: {
          orgId,
          targetTier,
        },
      }, { idempotencyKey: `struct:plan:v1:${org.stripe_subscription_id}:${targetTier}:${upgradeQuantity}` })

      if (updated.status !== 'active' || updated.pending_update) {
        throw createError({ statusCode: 409, message: 'Upgrade payment is not complete. Refresh billing before retrying.' })
      }

      const item = updated.items.data.find((candidate) => candidate.id === org.stripe_item_id)
      const { error } = await serviceSupabase
        .from('organizations')
        .update({
          subscription_tier: targetTier,
          stripe_subscription_id: updated.id,
          stripe_item_id: item?.id || org.stripe_item_id,
          stripe_quantity: item?.quantity ?? upgradeQuantity,
          stripe_customer_id:
            typeof updated.customer === 'string'
              ? updated.customer
              : updated.customer?.id || org.stripe_customer_id,
        })
        .eq('id', orgId)

      if (error) {
        throw createError({ statusCode: 500, message: error.message })
      }

      return {
        upgraded: true,
        subscriptionTier: targetTier,
        stripeQuantity: item?.quantity ?? upgradeQuantity,
      }
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: org.stripe_customer_id || undefined,
    line_items: [
      {
        price: priceId,
        quantity: TIER_CHECKOUT_QUANTITY[targetTier as PaidTier],
        adjustable_quantity: {
          enabled: true,
          minimum: TIER_CHECKOUT_QUANTITY[targetTier as PaidTier],
          maximum: 999999,
        },
      },
    ],
    success_url: `${origin}/dashboard/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard/settings?billing=cancel`,
    metadata: {
      orgId,
      targetTier,
      previousSubscriptionId: org.stripe_subscription_id || '',
    },
    subscription_data: {
      metadata: {
        orgId,
        targetTier,
      },
    },
  })

  if (!session.url) {
    throw createError({ statusCode: 500, message: 'Failed to create checkout session' })
  }

  return { url: session.url, upgraded: false }
})


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
  const priceId = getPriceIdForTier(targetTier as PaidTier, {
    flexible: config.stripePriceFlexible,
    pro: config.stripePricePro,
    scale: config.stripePriceScale,
  })

  if (!priceId) {
    throw createError({
      statusCode: 500,
      message: 'Stripe price IDs are not configured',
    })
  }

  const serviceSupabase = await serverSupabaseServiceRole(event)
  const org = await getOrganizationBilling(serviceSupabase, orgId)
  const stripe = useStripeClient()
  const origin = getRequestURL(event).origin
  const deviceCount = await countOrganizationDevices(serviceSupabase, orgId)
  const targetQuantity = getRequiredQuantity(targetTier, deviceCount)

  // Already subscribed: swap price on the existing subscription instead of
  // opening a second Checkout session (which left Flexible + Scale both active).
  if (org.stripe_subscription_id && org.stripe_item_id) {
    if (org.subscription_tier === targetTier) {
      throw createError({
        statusCode: 400,
        message: `Already on the ${targetTier} plan.`,
      })
    }

    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
      // Fall through to Checkout for a fresh subscription.
    } else {
      const currentStripeQuantity = subscription.items.data[0]?.quantity ?? 0
      // Never shrink paid capacity on a plan upgrade — keep portal extras.
      const upgradeQuantity = Math.max(
        targetQuantity,
        TIER_CHECKOUT_QUANTITY[targetTier as PaidTier],
        org.stripe_quantity,
        currentStripeQuantity,
      )
      const updated = await stripe.subscriptions.update(org.stripe_subscription_id, {
        items: [
          {
            id: org.stripe_item_id,
            price: priceId,
            quantity: upgradeQuantity,
          },
        ],
        proration_behavior: 'create_prorations',
        metadata: {
          orgId,
          targetTier,
        },
      })

      const item = updated.items.data[0]
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

      // Cancel any other active subscriptions on this customer (orphans from
      // earlier buggy upgrades that stacked Flexible + Scale).
      if (org.stripe_customer_id) {
        await cancelSiblingSubscriptions(
          stripe,
          org.stripe_customer_id,
          updated.id,
        )
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

async function cancelSiblingSubscriptions(
  stripe: ReturnType<typeof useStripeClient>,
  customerId: string,
  keepSubscriptionId: string,
) {
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 20,
  })

  await Promise.all(
    list.data
      .filter((sub) => sub.id !== keepSubscriptionId)
      .map(async (sub) => {
        try {
          await stripe.subscriptions.cancel(sub.id, {
            prorate: true,
          })
        } catch (err: any) {
          console.error(
            `[stripe] failed to cancel sibling subscription ${sub.id}:`,
            err?.message || err,
          )
        }
      }),
  )
}

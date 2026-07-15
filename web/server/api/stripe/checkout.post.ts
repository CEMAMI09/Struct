import { serverSupabaseServiceRole } from '#supabase/server'
import {
  getPriceIdForTier,
  TIER_CHECKOUT_QUANTITY,
  type PaidTier,
  type SubscriptionTier,
} from '../../utils/billing'
import { requireOrgWriter } from '../../utils/auth'
import { getOrganizationBilling } from '../../utils/organizations'
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

  return { url: session.url }
})

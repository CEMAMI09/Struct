import type Stripe from 'stripe'
import { TIER_CHECKOUT_QUANTITY, type PaidTier } from './billing'

const PORTAL_META_KEY = 'struct'
const PORTAL_META_VALUE = 'true_up_v2'

async function productIdForPrice(stripe: Stripe, priceId: string) {
  const price = await stripe.prices.retrieve(priceId)
  return typeof price.product === 'string' ? price.product : price.product.id
}

/**
 * Portal config for plan changes only — device overage is billed monthly via true-up.
 */
export async function getOrCreateQuantityPortalConfiguration(
  stripe: Stripe,
  prices: { flexible: string; pro: string; scale: string },
) {
  if (!prices.flexible || !prices.pro || !prices.scale) {
    throw createError({
      statusCode: 500,
      message: 'Stripe price IDs are not configured',
    })
  }

  const tiers: PaidTier[] = ['flexible', 'pro', 'scale']
  const products: Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[] =
    []

  for (const tier of tiers) {
    const priceId = prices[tier]
    const product = await productIdForPrice(stripe, priceId)
    products.push({
      product,
      prices: [priceId],
    })
  }

  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: {
      enabled: true,
      allowed_updates: ['email', 'address', 'tax_id'],
    },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      products,
    },
  }

  const existing = await stripe.billingPortal.configurations.list({ limit: 100 })
  const match = existing.data.find(
    (config) => config.active && config.metadata?.[PORTAL_META_KEY] === PORTAL_META_VALUE,
  )

  if (match) {
    return stripe.billingPortal.configurations.update(match.id, { features })
  }

  return stripe.billingPortal.configurations.create({
    features,
    business_profile: {
      headline: 'Manage your Struct subscription',
    },
    metadata: {
      [PORTAL_META_KEY]: PORTAL_META_VALUE,
    },
  })
}

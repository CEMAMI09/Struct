import type Stripe from 'stripe'

const PORTAL_META_KEY = 'struct'
const PORTAL_META_VALUE = 'billing_portal_v3_reviewed_plan_changes'

/** Portal permits cancellation and payment updates. A plan switch needs a
 * reviewed quantity/price quote in Struct, so the selected Stripe config
 * must disable subscription updates. This lookup never mutates Stripe. */
export async function getBillingPortalConfiguration(stripe: Stripe) {
  const existing = await stripe.billingPortal.configurations.list({ limit: 100 })
  const match = existing.data.find(
    (config) => config.active &&
      config.metadata?.[PORTAL_META_KEY] === PORTAL_META_VALUE &&
      config.features.subscription_update.enabled === false &&
      config.features.subscription_cancel.enabled === true,
  )
  if (match) return match

  throw createError({
    statusCode: 503,
    message: 'The safe billing portal configuration is not set up yet. Contact support.',
  })
}

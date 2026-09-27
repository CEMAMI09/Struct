import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import { getOrganizationBilling } from '../../utils/organizations'
import { getBillingPortalConfiguration } from '../../utils/portal'
import { useStripeClient } from '../../utils/stripe'
import { applyStripeSubscriptionToOrg } from '../../utils/syncStripeSubscription'
import { resolveStripePriceIds } from '../../utils/stripePriceContract'
import { ensureOrganizationStripeCustomer } from '../../utils/stripeCustomer'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ orgId?: string }>(event)
  const orgId = body?.orgId?.trim()

  if (!orgId) {
    throw createError({ statusCode: 400, message: 'orgId is required' })
  }

  await requireOrgWriter(event, orgId)

  const serviceSupabase = await serverSupabaseServiceRole(event)
  let org = await getOrganizationBilling(serviceSupabase, orgId)

  const config = useRuntimeConfig()
  const stripe = useStripeClient()
  const origin = getRequestURL(event).origin
  const prices = resolveStripePriceIds(config)
  const portalConfiguration = await getBillingPortalConfiguration(stripe)

  // Free orgs may not have a Stripe customer yet — create one so they can
  // open the portal and subscribe / upgrade.
  let customerId = org.stripe_customer_id
  if (!customerId) {
    customerId = await ensureOrganizationStripeCustomer(serviceSupabase, stripe, org)
    org = await getOrganizationBilling(serviceSupabase, orgId)
  }

  // Opening billing must never cancel a subscription. Reconcile the subscription
  // already linked to this organization; investigate other active subscriptions
  // separately, with an explicit customer-approved billing action.
  if (org.stripe_subscription_id) {
    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    await applyStripeSubscriptionToOrg(serviceSupabase, subscription, prices, orgId)
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    configuration: portalConfiguration.id,
    return_url: `${origin}/dashboard/settings`,
  })

  return { url: session.url }
})

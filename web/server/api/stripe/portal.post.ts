import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import { getOrganizationBilling } from '../../utils/organizations'
import { getOrCreateQuantityPortalConfiguration } from '../../utils/portal'
import { useStripeClient } from '../../utils/stripe'
import {
  applyStripeSubscriptionToOrg,
  pickBestSubscription,
} from '../../utils/syncStripeSubscription'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ orgId?: string }>(event)
  const orgId = body?.orgId?.trim()

  if (!orgId) {
    throw createError({ statusCode: 400, message: 'orgId is required' })
  }

  await requireOrgWriter(event, orgId)

  const serviceSupabase = await serverSupabaseServiceRole(event)
  const org = await getOrganizationBilling(serviceSupabase, orgId)

  if (!org.stripe_customer_id) {
    throw createError({
      statusCode: 400,
      message: 'No Stripe customer on file — subscribe to a paid plan first',
    })
  }

  const config = useRuntimeConfig()
  const stripe = useStripeClient()
  const origin = getRequestURL(event).origin
  const prices = {
    flexible: config.stripePriceFlexible,
    pro: config.stripePricePro,
    scale: config.stripePriceScale,
  }

  // Repair stacked subscriptions: keep the highest-quantity plan, cancel orphans.
  const siblings = await stripe.subscriptions.list({
    customer: org.stripe_customer_id,
    status: 'active',
    limit: 20,
  })
  const best = pickBestSubscription(siblings.data)
  if (best) {
    try {
      await applyStripeSubscriptionToOrg(serviceSupabase, best, prices, orgId)
    } catch (err: any) {
      console.error('[stripe portal] failed to sync best subscription:', err?.message || err)
    }
    await Promise.all(
      siblings.data
        .filter((sub) => sub.id !== best.id)
        .map((sub) =>
          stripe.subscriptions.cancel(sub.id, { prorate: true }).catch((err: any) => {
            console.error(
              `[stripe portal] failed to cancel orphan ${sub.id}:`,
              err?.message || err,
            )
          }),
        ),
    )
  }

  const portalConfiguration = await getOrCreateQuantityPortalConfiguration(stripe, {
    flexible: config.stripePriceFlexible,
    pro: config.stripePricePro,
    scale: config.stripePriceScale,
  })

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    configuration: portalConfiguration.id,
    return_url: `${origin}/dashboard/settings`,
  })

  return { url: session.url }
})

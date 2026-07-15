import type Stripe from 'stripe'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { PaidTier, SubscriptionTier } from '../../utils/billing'
import { useStripeClient } from '../../utils/stripe'
import { applyStripeSubscriptionToOrg } from '../../utils/syncStripeSubscription'
import { processPeriodTrueUp, syncUsagePeriodFromSubscription } from '../../utils/trueUpBilling'

const PAID_TIERS = new Set<PaidTier>(['flexible', 'pro', 'scale'])

function parseTier(value: string | null | undefined): SubscriptionTier | null {
  if (!value) return null
  if (value === 'free') return 'free'
  if (PAID_TIERS.has(value as PaidTier)) return value as PaidTier
  return null
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.stripeWebhookSecret) {
    throw createError({
      statusCode: 500,
      message: 'Stripe webhook secret is not configured',
    })
  }

  const signature = getHeader(event, 'stripe-signature')
  if (!signature) {
    throw createError({ statusCode: 400, message: 'Missing Stripe signature' })
  }

  const rawBody = await readRawBody(event)
  if (!rawBody) {
    throw createError({ statusCode: 400, message: 'Missing request body' })
  }

  const stripe = useStripeClient()
  let stripeEvent: Stripe.Event

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripeWebhookSecret,
    )
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      message: `Webhook signature verification failed: ${err.message}`,
    })
  }

  const serviceSupabase = await serverSupabaseServiceRole(event)
  const prices = {
    flexible: config.stripePriceFlexible,
    pro: config.stripePricePro,
    scale: config.stripePriceScale,
  }

  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const session = stripeEvent.data.object as Stripe.Checkout.Session
      const orgId = session.metadata?.orgId
      const targetTier = parseTier(session.metadata?.targetTier)

      if (!orgId || !targetTier || targetTier === 'free') break

      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id || null
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id || null

      if (!subscriptionId) break

      const { data: previousOrg } = await serviceSupabase
        .from('organizations')
        .select('stripe_subscription_id')
        .eq('id', orgId)
        .maybeSingle()

      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      try {
        await applyStripeSubscriptionToOrg(serviceSupabase, subscription, prices, orgId)
        await serviceSupabase
          .from('organizations')
          .update({ subscription_tier: targetTier })
          .eq('id', orgId)
      } catch (err: any) {
        console.error('[stripe webhook] checkout.session.completed failed:', err?.message || err)
      }

      const previousSubscriptionId =
        session.metadata?.previousSubscriptionId || previousOrg?.stripe_subscription_id || null
      if (
        previousSubscriptionId &&
        subscriptionId &&
        previousSubscriptionId !== subscriptionId
      ) {
        try {
          await stripe.subscriptions.cancel(previousSubscriptionId, { prorate: true })
        } catch (err: any) {
          console.error(
            `[stripe webhook] failed to cancel previous subscription ${previousSubscriptionId}:`,
            err?.message || err,
          )
        }
      }

      if (customerId && subscriptionId) {
        try {
          const siblings = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 20,
          })
          await Promise.all(
            siblings.data
              .filter((sub) => sub.id !== subscriptionId)
              .map((sub) =>
                stripe.subscriptions
                  .cancel(sub.id, { prorate: true })
                  .catch((err: any) => {
                    console.error(
                      `[stripe webhook] failed to cancel orphan ${sub.id}:`,
                      err?.message || err,
                    )
                  }),
              ),
          )
        } catch (err: any) {
          console.error(
            '[stripe webhook] failed listing sibling subscriptions:',
            err?.message || err,
          )
        }
      }
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      const orgId = subscription.metadata?.orgId || null
      try {
        await applyStripeSubscriptionToOrg(serviceSupabase, subscription, prices, orgId)
        if (orgId) {
          await syncUsagePeriodFromSubscription(serviceSupabase, subscription, orgId)
        }
      } catch (err: any) {
        console.error('[stripe webhook] failed to sync subscription:', err?.message || err)
      }
      break
    }

    case 'invoice.created': {
      const invoice = stripeEvent.data.object as Stripe.Invoice
      const subscriptionId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id || null
      if (!subscriptionId) break

      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      const orgId = subscription.metadata?.orgId
      if (!orgId) break

      const periodStart = new Date(subscription.current_period_start * 1000)
      try {
        await processPeriodTrueUp(serviceSupabase, orgId, periodStart)
        await syncUsagePeriodFromSubscription(serviceSupabase, subscription, orgId)
      } catch (err: any) {
        console.error('[stripe webhook] true-up failed:', err?.message || err)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      const orgId = subscription.metadata?.orgId

      const patch = {
        subscription_tier: 'free' as const,
        stripe_subscription_id: null,
        stripe_item_id: null,
        stripe_quantity: 0,
      }

      // Only clear billing when THIS subscription is the one currently linked.
      // Orphan cancellations share metadata.orgId and must not wipe a paid plan.
      let query = serviceSupabase
        .from('organizations')
        .update(patch)
        .eq('stripe_subscription_id', subscription.id)
      if (orgId) {
        query = query.eq('id', orgId)
      }

      const { error } = await query
      if (error) {
        console.error('[stripe webhook] subscription.deleted failed:', error.message)
      }
      break
    }

    default:
      break
  }

  return { received: true }
})

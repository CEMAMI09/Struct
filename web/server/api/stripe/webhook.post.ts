import type Stripe from 'stripe'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { PaidTier, SubscriptionTier } from '../../utils/billing'
import { useStripeClient } from '../../utils/stripe'
import { customerIdFromInvoice, subscriptionIdFromInvoice } from '../../utils/stripeInvoice'
import { applyStripeSubscriptionToOrg } from '../../utils/syncStripeSubscription'
import { processClosedUsagePeriods } from '../../utils/trueUpBilling'

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
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = stripeEvent.data.object as Stripe.Checkout.Session
      if (session.mode !== 'subscription' || session.status !== 'complete') break
      if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') break
      const orgId = session.metadata?.orgId
      const targetTier = parseTier(session.metadata?.targetTier)

      if (!orgId || !targetTier || targetTier === 'free') break

      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id || null

      if (!subscriptionId) break

      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      if (subscription.status !== 'active' && subscription.status !== 'trialing') break
      const sessionCustomer = typeof session.customer === 'string'
        ? session.customer : session.customer?.id || null
      const subscriptionCustomer = typeof subscription.customer === 'string'
        ? subscription.customer : subscription.customer?.id || null
      if (!sessionCustomer || sessionCustomer !== subscriptionCustomer) {
        throw createError({ statusCode: 500, message: 'Checkout customer mismatch' })
      }
      const result = await applyStripeSubscriptionToOrg(serviceSupabase, subscription, prices, orgId, true)
      if (!result || result.subscriptionTier !== targetTier) {
        throw createError({ statusCode: 500, message: 'Checkout plan could not be reconciled' })
      }
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      // Events can be delivered out of order. Reconcile the current Stripe
      // object, not a stale event snapshot that could roll a paid plan back.
      const eventSubscription = stripeEvent.data.object as Stripe.Subscription
      const subscription = await stripe.subscriptions.retrieve(eventSubscription.id)
      const orgId = subscription.metadata?.orgId || null
      await applyStripeSubscriptionToOrg(serviceSupabase, subscription, prices, orgId)
      break
    }

    case 'invoice.created': {
      const invoice = stripeEvent.data.object as Stripe.Invoice
      if (invoice.status !== 'draft') break
      // Stripe sends the first invoice before Checkout completes and links the
      // new subscription to the organization. There is no closed usage period
      // on that subscription to true up yet; rejecting it can stall Checkout.
      if (invoice.billing_reason === 'subscription_create') break
      const subscriptionId = subscriptionIdFromInvoice(invoice)
      if (!subscriptionId) break

      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      const orgId = subscription.metadata?.orgId
      if (!orgId) break

      const { data: org, error: orgError } = await serviceSupabase
        .from('organizations')
        .select('stripe_customer_id, stripe_subscription_id')
        .eq('id', orgId)
        .maybeSingle()
      if (orgError) throw createError({ statusCode: 500, message: orgError.message })
      if (
        !org ||
        org.stripe_subscription_id !== subscriptionId ||
        org.stripe_customer_id !== customerIdFromInvoice(invoice)
      ) {
        throw createError({ statusCode: 500, message: 'Invoice does not match organization billing' })
      }
      await processClosedUsagePeriods(serviceSupabase, stripe, orgId, invoice.id)
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
        throw createError({ statusCode: 500, message: error.message })
      }
      break
    }

    default:
      break
  }

  return { received: true }
})

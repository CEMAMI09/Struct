import type Stripe from 'stripe'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { PaidTier, SubscriptionTier } from '../../utils/billing'
import { useStripeClient } from '../../utils/stripe'

const PAID_TIERS = new Set<PaidTier>(['flexible', 'pro', 'scale'])

function parseTier(value: string | null | undefined): SubscriptionTier | null {
  if (!value) return null
  if (value === 'free') return 'free'
  if (PAID_TIERS.has(value as PaidTier)) return value as PaidTier
  return null
}

function tierForPrice(
  priceId: string | undefined,
  prices: { flexible: string; pro: string; scale: string },
): PaidTier | null {
  if (!priceId) return null
  if (priceId === prices.flexible) return 'flexible'
  if (priceId === prices.pro) return 'pro'
  if (priceId === prices.scale) return 'scale'
  return null
}

async function syncSubscription(
  supabase: Awaited<ReturnType<typeof serverSupabaseServiceRole>>,
  subscription: Stripe.Subscription,
  prices: { flexible: string; pro: string; scale: string },
) {
  const orgId = subscription.metadata?.orgId
  const item = subscription.items.data[0]
  if (!item) return

  const patch: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    stripe_customer_id:
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id || null,
    stripe_item_id: item.id,
    stripe_quantity: item.quantity ?? 0,
  }

  // The current price is authoritative because Customer Portal plan switches
  // don't rewrite the metadata originally attached by Checkout.
  const tier =
    tierForPrice(item.price.id, prices) ||
    parseTier(subscription.metadata?.targetTier) ||
    parseTier(subscription.metadata?.tier)

  if (tier && tier !== 'free') {
    patch.subscription_tier = tier
  }

  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    patch.subscription_tier = 'free'
    patch.stripe_subscription_id = null
    patch.stripe_item_id = null
    patch.stripe_quantity = 0
  }

  let query = supabase.from('organizations').update(patch)

  if (orgId) {
    query = query.eq('id', orgId)
  } else {
    query = query.eq('stripe_subscription_id', subscription.id)
  }

  const { error } = await query
  if (error) {
    console.error('[stripe webhook] failed to sync subscription:', error.message)
  }
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

      const patch: Record<string, unknown> = {
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        subscription_tier: targetTier,
      }

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const item = subscription.items.data[0]
        if (item) {
          patch.stripe_item_id = item.id
          patch.stripe_quantity = item.quantity ?? 0
        }
      }

      const { error } = await serviceSupabase
        .from('organizations')
        .update(patch)
        .eq('id', orgId)

      if (error) {
        console.error('[stripe webhook] checkout.session.completed failed:', error.message)
      }
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      await syncSubscription(serviceSupabase, subscription, {
        flexible: config.stripePriceFlexible,
        pro: config.stripePricePro,
        scale: config.stripePriceScale,
      })
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

      let query = serviceSupabase.from('organizations').update(patch)
      query = orgId
        ? query.eq('id', orgId)
        : query.eq('stripe_subscription_id', subscription.id)

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

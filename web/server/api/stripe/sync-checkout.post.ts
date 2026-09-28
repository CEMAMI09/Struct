import { serverSupabaseServiceRole } from '#supabase/server'
import type { PaidTier, SubscriptionTier } from '../../utils/billing'
import { requireOrgWriter } from '../../utils/auth'
import { useStripeClient } from '../../utils/stripe'
import { reconcileStripeSubscription } from '../../utils/reconcileStripeSubscription'
import { resolveStripePriceIds } from '../../utils/stripePriceContract'

const PAID_TIERS = new Set<PaidTier>(['flexible', 'pro', 'scale'])

function parseTier(value: string | null | undefined): SubscriptionTier | null {
  if (!value) return null
  if (value === 'free') return 'free'
  if (PAID_TIERS.has(value as PaidTier)) return value as PaidTier
  return null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ sessionId?: string }>(event)
  const sessionId = body?.sessionId?.trim()

  if (!sessionId) {
    throw createError({ statusCode: 400, message: 'sessionId is required' })
  }

  const stripe = useStripeClient()
  const session = await stripe.checkout.sessions.retrieve(sessionId)

  if (session.mode !== 'subscription' || session.status !== 'complete') {
    throw createError({
      statusCode: 400,
      message: 'Checkout session is not a completed subscription',
    })
  }
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    throw createError({ statusCode: 409, message: 'Checkout payment has not completed yet.' })
  }

  const orgId = session.metadata?.orgId
  const targetTier = parseTier(session.metadata?.targetTier)

  if (!orgId || !targetTier || targetTier === 'free') {
    throw createError({
      statusCode: 400,
      message: 'Checkout session is missing org or tier metadata',
    })
  }

  await requireOrgWriter(event, orgId)

  const serviceSupabase = await serverSupabaseServiceRole(event)
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id || null

  if (!subscriptionId) {
    throw createError({ statusCode: 500, message: 'Checkout session has no subscription' })
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    throw createError({ statusCode: 409, message: 'Subscription payment has not completed yet.' })
  }
  const sessionCustomer = typeof session.customer === 'string'
    ? session.customer : session.customer?.id || null
  const subscriptionCustomer = typeof subscription.customer === 'string'
    ? subscription.customer : subscription.customer?.id || null
  if (!sessionCustomer || sessionCustomer !== subscriptionCustomer) {
    throw createError({ statusCode: 500, message: 'Checkout customer mismatch' })
  }
  const result = await reconcileStripeSubscription(
    serviceSupabase, stripe, subscriptionId, resolveStripePriceIds(useRuntimeConfig()), orgId, true,
  )
  if (!result || result.subscriptionTier !== targetTier) {
    throw createError({ statusCode: 500, message: 'Checkout plan could not be reconciled' })
  }

  const { error: releaseError } = await serviceSupabase.rpc('release_org_checkout_session', {
    p_org_id: orgId,
    p_session_id: session.id,
  })
  if (releaseError) {
    console.error('[stripe] failed to release completed Checkout session', { orgId, sessionId: session.id, error: releaseError.message })
  }

  return {
    ok: true,
    subscriptionTier: result.subscriptionTier,
    stripeQuantity: result.stripeQuantity,
  }
})

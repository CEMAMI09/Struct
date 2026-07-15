import { serverSupabaseServiceRole } from '#supabase/server'
import type { PaidTier, SubscriptionTier } from '../../utils/billing'
import { requireOrgWriter } from '../../utils/auth'
import { getOrganizationBilling } from '../../utils/organizations'
import { useStripeClient } from '../../utils/stripe'

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
  const previousOrg = await getOrganizationBilling(serviceSupabase, orgId)

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

  const { error } = await serviceSupabase.from('organizations').update(patch).eq('id', orgId)

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }

  // Cancel the previous subscription if Checkout created a replacement.
  const previousSubscriptionId =
    session.metadata?.previousSubscriptionId || previousOrg.stripe_subscription_id
  if (
    previousSubscriptionId &&
    subscriptionId &&
    previousSubscriptionId !== subscriptionId
  ) {
    try {
      await stripe.subscriptions.cancel(previousSubscriptionId, { prorate: true })
    } catch (err: any) {
      console.error(
        `[stripe] failed to cancel previous subscription ${previousSubscriptionId}:`,
        err?.message || err,
      )
    }
  }

  if (customerId && subscriptionId) {
    const siblings = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 20,
    })
    await Promise.all(
      siblings.data
        .filter((sub) => sub.id !== subscriptionId)
        .map((sub) =>
          stripe.subscriptions.cancel(sub.id, { prorate: true }).catch((err: any) => {
            console.error(
              `[stripe] failed to cancel orphan subscription ${sub.id}:`,
              err?.message || err,
            )
          }),
        ),
    )
  }

  return {
    ok: true,
    subscriptionTier: targetTier,
    stripeQuantity: patch.stripe_quantity ?? 0,
  }
})

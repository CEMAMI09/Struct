import { randomUUID } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import {
  getPriceIdForTier,
  getRequiredQuantity,
  TIER_CHECKOUT_QUANTITY,
  type PaidTier,
  type SubscriptionTier,
} from '../../utils/billing'
import { requireOrgWriter } from '../../utils/auth'
import {
  countOrganizationDevices,
  getOrganizationBilling,
} from '../../utils/organizations'
import { useStripeClient } from '../../utils/stripe'
import { applyStripeSubscriptionToOrg } from '../../utils/syncStripeSubscription'
import { assertStripePriceMatchesPlan, resolveStripePriceIds, tierForStripePrice } from '../../utils/stripePriceContract'
import { ensureOrganizationStripeCustomer } from '../../utils/stripeCustomer'
import { isDefinitiveStripeFailure, withOrgBillingLock } from '../../utils/stripeBillingLock'
import { reuseOrExpireCheckoutSession } from '../../utils/checkoutSession'

const PAID_TIERS: PaidTier[] = ['flexible', 'pro', 'scale']
type CheckoutClaim = {
  status: 'claimed' | 'busy' | 'subscribed' | 'session' | 'different_plan' | 'reconcile'
  claimToken?: string
  sessionId?: string
}

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
  const prices = resolveStripePriceIds(config)
  const priceId = getPriceIdForTier(targetTier as PaidTier, prices)

  if (!priceId) {
    throw createError({
      statusCode: 500,
      message: 'Stripe price IDs are not configured',
    })
  }

  const serviceSupabase = await serverSupabaseServiceRole(event)
  let org = await getOrganizationBilling(serviceSupabase, orgId)
  const stripe = useStripeClient()
  await assertStripePriceMatchesPlan(stripe, targetTier as PaidTier, priceId)
  const origin = getRequestURL(event).origin
  const deviceCount = await countOrganizationDevices(serviceSupabase, orgId)
  const targetQuantity = getRequiredQuantity(targetTier, deviceCount)

  // Already subscribed: swap price on the existing subscription instead of
  // opening a second Checkout session (which left Flexible + Scale both active).
  if (org.stripe_subscription_id) {
    const upgraded = await withOrgBillingLock(serviceSupabase, orgId, async (guard) => {
      org = await getOrganizationBilling(serviceSupabase, orgId)
      const subscriptionId = org.stripe_subscription_id
      if (!subscriptionId) return null
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      const subscriptionCustomer = typeof subscription.customer === 'string'
        ? subscription.customer : subscription.customer?.id || null
      if (!org.stripe_customer_id || subscriptionCustomer !== org.stripe_customer_id) {
        throw createError({ statusCode: 409, message: 'Billing customer mismatch. Contact support.' })
      }
      if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
        // Clear a stale ended subscription before opening a new Checkout. A
        // completed session must never replace an active linked subscription.
        await applyStripeSubscriptionToOrg(serviceSupabase, subscription, prices, orgId, false, guard.token)
        org = await getOrganizationBilling(serviceSupabase, orgId)
        if (org.stripe_subscription_id) {
          throw createError({ statusCode: 409, message: 'Billing is being synchronized. Please retry.' })
        }
      } else {
        if (subscription.status !== 'active') {
          throw createError({ statusCode: 409, message: 'Resolve the subscription payment in Manage billing before changing plans.' })
        }
        if (!org.stripe_item_id) {
          throw createError({ statusCode: 409, message: 'Billing needs to be synchronized before changing plans.' })
        }
        if (org.subscription_tier === targetTier) {
          throw createError({ statusCode: 400, message: `Already on the ${targetTier} plan.` })
        }
        const currentItem = subscription.items.data.find((item) => item.id === org.stripe_item_id)
        if (!currentItem) {
          throw createError({ statusCode: 409, message: 'Billing item mismatch. Synchronize billing and retry.' })
        }
        const currentTier = tierForStripePrice(currentItem.price.id, prices)
        if (!currentTier) {
          throw createError({ statusCode: 409, message: 'Billing price mismatch. Contact support.' })
        }
        if (PAID_TIERS.indexOf(targetTier as PaidTier) < PAID_TIERS.indexOf(currentTier)) {
          throw createError({
            statusCode: 409,
            message: 'Plan downgrades need a reviewed device quantity and price. Contact support before changing tiers.',
          })
        }
        if (targetTier === currentTier) {
          throw createError({ statusCode: 409, message: 'Billing needs to be synchronized before changing plans.' })
        }
        // Keep the paid quantity on upgrades. Downgrades require a reviewed quote
        // because carrying this quantity into a higher unit price is surprising.
        const upgradeQuantity = Math.max(
          targetQuantity,
          TIER_CHECKOUT_QUANTITY[targetTier as PaidTier],
          currentItem.quantity ?? 0,
        )
        let mutated = false
        await guard.startMutation()
        try {
          const updated = await stripe.subscriptions.update(subscriptionId, {
            items: [
              {
                id: org.stripe_item_id,
                price: priceId,
                quantity: upgradeQuantity,
              },
            ],
            // Collect an upgrade charge now. If the card declines or requires
            // customer action, Stripe leaves the old plan in force and we do not
            // grant the new capacity in Supabase.
            proration_behavior: 'always_invoice',
            payment_behavior: 'error_if_incomplete',
            metadata: {
              orgId,
              targetTier,
            },
          }, { idempotencyKey: `struct:plan:v2:${guard.token}` })
          mutated = true

          if (updated.status !== 'active' || updated.pending_update) {
            throw createError({ statusCode: 409, message: 'Upgrade payment is not complete. Refresh billing before retrying.' })
          }

          // The guard also covers webhook reconciliation, so no older snapshot
          // can overwrite this paid plan while we commit the live Stripe state.
          const confirmed = await stripe.subscriptions.retrieve(updated.id)
          const result = await applyStripeSubscriptionToOrg(serviceSupabase, confirmed, prices, orgId, false, guard.token)
          if (!result || result.subscriptionTier !== targetTier) {
            throw createError({ statusCode: 409, message: 'Billing changed during the upgrade. Refresh billing.' })
          }

          return {
            upgraded: true,
            subscriptionTier: result.subscriptionTier,
            stripeQuantity: result.stripeQuantity,
          }
        } catch (error) {
          if (mutated || !isDefinitiveStripeFailure(error)) guard.retain()
          throw error
        }
      }
      return null
    }, false)
    if (upgraded) return upgraded
  }

  // Bind Checkout to one stable Stripe customer. Otherwise two free-org
  // sessions can each create a different customer and paid subscription.
  const customerId = await ensureOrganizationStripeCustomer(serviceSupabase, stripe, org)
  if (!org.stripe_customer_id) {
    org = await getOrganizationBilling(serviceSupabase, orgId)
  }

  // A completed session whose webhook has not arrived must not let the org
  // start another paid subscription. Session claims below cover requests that
  // race before either session completes.
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  })
  if (subscriptions.has_more || subscriptions.data.some((subscription) =>
    subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired')) {
    throw createError({
      statusCode: 409,
      message: 'A Stripe subscription already exists for this organization. Refresh billing or contact support.',
    })
  }

  let claimToken: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: rawClaim, error: claimError } = await serviceSupabase.rpc('claim_org_checkout_session', {
      p_org_id: orgId,
      p_claim_token: randomUUID(),
      p_target_tier: targetTier,
    })
    if (claimError) throw createError({ statusCode: 500, message: claimError.message })
    const claim = rawClaim as CheckoutClaim | null
    if (claim?.status === 'claimed' && typeof claim.claimToken === 'string') {
      claimToken = claim.claimToken
      break
    }
    if (claim?.status === 'busy') {
      throw createError({ statusCode: 409, message: 'Checkout is starting. Please retry in a moment.' })
    }
    if (claim?.status === 'different_plan') {
      throw createError({ statusCode: 409, message: 'A checkout for another plan is in progress. Complete or cancel it first.' })
    }
    if (claim?.status === 'subscribed') {
      throw createError({ statusCode: 409, message: 'Billing changed. Refresh before choosing a plan.' })
    }
    let sessionId = claim?.sessionId
    if (claim?.status === 'reconcile' && typeof claim.claimToken === 'string') {
      const recent = await stripe.checkout.sessions.list({ customer: customerId, limit: 100 })
      const recovered = recent.data.find((session) =>
        session.metadata?.checkoutClaimToken === claim.claimToken)
      if (!recovered) {
        throw createError({ statusCode: 503, message: 'A previous checkout has an unknown outcome. Contact support before starting another payment.' })
      }
      const { data: recorded, error } = await serviceSupabase.rpc('complete_org_checkout_session', {
        p_org_id: orgId, p_claim_token: claim.claimToken,
        p_session_id: recovered.id,
        p_expires_at: new Date(recovered.expires_at * 1000).toISOString(),
      })
      if (error || !recorded) {
        throw createError({ statusCode: 503, message: 'Checkout state needs reconciliation. Contact support.' })
      }
      sessionId = recovered.id
    }
    if (typeof sessionId === 'string') {
      const prior = await reuseOrExpireCheckoutSession(stripe, sessionId, {
        orgId, customerId, targetTier: targetTier as PaidTier,
      })
      if (prior.status === 'open') {
        return { url: prior.url, upgraded: false }
      }
      if (prior.status === 'expired') {
        // Stripe has confirmed the old link cannot accept payment. Exact-ID
        // release keeps concurrent switches and delayed webhooks from clearing
        // a replacement claim; the next claim still serializes new creation.
        const { error: releaseError } = await serviceSupabase.rpc('release_org_checkout_session', {
          p_org_id: orgId, p_session_id: prior.id,
        })
        if (releaseError) throw createError({ statusCode: 500, message: releaseError.message })
        continue
      }
    }
    throw createError({ statusCode: 503, message: 'Checkout state needs reconciliation. Contact support.' })
  }
  if (!claimToken) {
    throw createError({ statusCode: 503, message: 'Checkout could not be reserved. Please retry.' })
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: orgId,
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
        previousSubscriptionId: org.stripe_subscription_id || '',
        checkoutClaimToken: claimToken,
      },
      subscription_data: {
        metadata: {
          orgId,
          targetTier,
        },
      },
    }, { idempotencyKey: `struct:checkout:v1:${claimToken}` })
  } catch (error: any) {
    // Definitive validation/payment failures did not create a session.
    // Timeouts, idempotency conflicts and 5xx need reconciliation before retry.
    if (isDefinitiveStripeFailure(error)) {
      const { error: releaseError } = await serviceSupabase.rpc('release_org_checkout_claim', {
        p_org_id: orgId, p_claim_token: claimToken,
      })
      if (releaseError) console.error('[stripe] failed to release rejected Checkout claim', { orgId, error: releaseError.message })
    } else {
      console.error('[stripe] ambiguous Checkout creation; claim retained for reconciliation', { orgId, error: error?.message })
    }
    throw error
  }

  if (!session.url) {
    throw createError({ statusCode: 500, message: 'Failed to create checkout session' })
  }

  const { data: recorded, error: recordError } = await serviceSupabase.rpc('complete_org_checkout_session', {
    p_org_id: orgId,
    p_claim_token: claimToken,
    p_session_id: session.id,
    p_expires_at: new Date(session.expires_at * 1000).toISOString(),
  })
  if (recordError || !recorded) {
    console.error('[stripe] failed to record Checkout session', { orgId, sessionId: session.id, error: recordError?.message })
    throw createError({ statusCode: 503, message: 'Checkout session needs reconciliation. Contact support.' })
  }

  return { url: session.url, upgraded: false }
})


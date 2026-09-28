import type Stripe from 'stripe'
import type { PaidTier } from './billing'

type CheckoutOwner = { orgId: string; customerId: string; targetTier: PaidTier }

function assertCheckoutOwner(session: Stripe.Checkout.Session, owner: CheckoutOwner) {
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  if (session.mode !== 'subscription' || customerId !== owner.customerId
    || session.metadata?.orgId !== owner.orgId || session.client_reference_id !== owner.orgId) {
    throw createError({ statusCode: 409, message: 'Checkout does not match organization billing. Contact support.' })
  }
}

function completedCheckout() {
  return createError({ statusCode: 409, message: 'A prior Checkout completed. Refresh billing before starting another payment.' })
}

function unknownCheckout() {
  return createError({ statusCode: 503, message: 'Checkout state could not be confirmed. Please retry before starting another payment.' })
}

/** Return the same plan's open session, or confirm the old session is expired.
 * Callers may release its exact database claim only after an expired result.
 * Closing a browser tab alone never proves Checkout was canceled in Stripe. */
export async function reuseOrExpireCheckoutSession(
  stripe: Stripe,
  sessionId: string,
  owner: CheckoutOwner,
): Promise<Stripe.Checkout.Session> {
  let session = await stripe.checkout.sessions.retrieve(sessionId)
  assertCheckoutOwner(session, owner)
  if (session.status === 'complete') throw completedCheckout()

  if (session.status === 'open') {
    // Even an open session must have no payment/subscription before replacing it.
    if (session.payment_status !== 'unpaid' || session.subscription || session.invoice || session.payment_intent) {
      throw unknownCheckout()
    }
    if (session.metadata?.targetTier === owner.targetTier) {
      if (!session.url) throw unknownCheckout()
      return session
    }

    try {
      session = await stripe.checkout.sessions.expire(session.id, {}, {
        idempotencyKey: `struct:checkout-expire:v1:${session.id}`,
      })
    } catch {
      // Expiration can lose a race with payment or another switch, or time out
      // after Stripe accepted it. Only a fresh Stripe read can settle that.
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId)
      } catch {
        throw unknownCheckout()
      }
    }
    assertCheckoutOwner(session, owner)
    if (session.status === 'complete') throw completedCheckout()
  }

  if (session.status !== 'expired' || session.payment_status !== 'unpaid'
    || session.subscription || session.invoice || session.payment_intent) {
    throw unknownCheckout()
  }
  return session
}

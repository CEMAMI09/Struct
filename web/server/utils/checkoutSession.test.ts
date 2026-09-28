import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { reuseOrExpireCheckoutSession } from './checkoutSession'

const owner = { orgId: 'org_1', customerId: 'cus_1', targetTier: 'pro' as const }
const openSession = {
  id: 'cs_1', mode: 'subscription', customer: owner.customerId,
  client_reference_id: owner.orgId,
  metadata: { orgId: owner.orgId, targetTier: 'flexible' },
  status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/old',
  subscription: null, invoice: null, payment_intent: null,
} as unknown as Stripe.Checkout.Session
const expiredSession = { ...openSession, status: 'expired', url: null } as Stripe.Checkout.Session

beforeEach(() => {
  vi.stubGlobal('createError', ({ message, statusCode }: { message: string; statusCode: number }) =>
    Object.assign(new Error(message), { statusCode }))
})

function mockStripe(prior = openSession) {
  const retrieve = vi.fn().mockResolvedValue(prior)
  const expire = vi.fn().mockResolvedValue(expiredSession)
  const stripe = { checkout: { sessions: { retrieve, expire } } } as unknown as Stripe
  return { stripe, retrieve, expire }
}

describe('switching an unpaid Checkout plan', () => {
  it('expires the old session before allowing its claim to be replaced', async () => {
    const { stripe, expire } = mockStripe()
    expect(await reuseOrExpireCheckoutSession(stripe, openSession.id, owner)).toBe(expiredSession)
    expect(expire).toHaveBeenCalledWith(openSession.id, {}, {
      idempotencyKey: `struct:checkout-expire:v1:${openSession.id}`,
    })
  })

  it('reuses the same plan without expiring it', async () => {
    const prior = { ...openSession, metadata: { ...openSession.metadata, targetTier: 'pro' } }
    const { stripe, expire } = mockStripe(prior)
    expect(await reuseOrExpireCheckoutSession(stripe, prior.id, owner)).toBe(prior)
    expect(expire).not.toHaveBeenCalled()
  })

  it('allows an already expired unpaid session to be released', async () => {
    const { stripe, expire } = mockStripe(expiredSession)
    expect(await reuseOrExpireCheckoutSession(stripe, expiredSession.id, owner)).toBe(expiredSession)
    expect(expire).not.toHaveBeenCalled()
  })

  it('preserves a concurrent replacement when the caller has no creation attempts left', async () => {
    const { stripe, expire } = mockStripe()
    await expect(reuseOrExpireCheckoutSession(stripe, openSession.id, owner, false))
      .rejects.toMatchObject({ statusCode: 409, message: 'Checkout changed in another request. Please retry your chosen plan.' })
    expect(expire).not.toHaveBeenCalled()
  })

  it('still reuses the winning plan without another creation attempt', async () => {
    const prior = { ...openSession, metadata: { ...openSession.metadata, targetTier: 'pro' } }
    const { stripe, expire } = mockStripe(prior)
    expect(await reuseOrExpireCheckoutSession(stripe, prior.id, owner, false)).toBe(prior)
    expect(expire).not.toHaveBeenCalled()
  })

  it.each([
    ['other customer', { customer: 'cus_other' }],
    ['other organization metadata', { metadata: { orgId: 'org_other', targetTier: 'flexible' } }],
    ['other client reference', { client_reference_id: 'org_other' }],
    ['other Checkout mode', { mode: 'payment' }],
  ])('never expires a session with %s', async (_name, patch) => {
    const prior = { ...openSession, ...patch } as Stripe.Checkout.Session
    const { stripe, expire } = mockStripe(prior)
    await expect(reuseOrExpireCheckoutSession(stripe, prior.id, owner)).rejects.toMatchObject({ statusCode: 409 })
    expect(expire).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'complete' },
    { payment_status: 'paid' },
    { payment_status: 'no_payment_required' },
    { subscription: 'sub_1' },
    { invoice: 'in_1' },
    { payment_intent: 'pi_1' },
  ])('never expires a session with payment or a completed state: %j', async (patch) => {
    const prior = { ...openSession, ...patch } as Stripe.Checkout.Session
    const { stripe, expire } = mockStripe(prior)
    await expect(reuseOrExpireCheckoutSession(stripe, prior.id, owner)).rejects.toThrow()
    expect(expire).not.toHaveBeenCalled()
  })

  it('blocks a payment that completes while expiration is attempted', async () => {
    const { stripe, retrieve, expire } = mockStripe()
    expire.mockRejectedValue(new Error('Session is no longer open'))
    retrieve.mockResolvedValueOnce(openSession).mockResolvedValueOnce({ ...openSession, status: 'complete', subscription: 'sub_1' })
    await expect(reuseOrExpireCheckoutSession(stripe, openSession.id, owner)).rejects.toMatchObject({ statusCode: 409 })
    expect(retrieve).toHaveBeenCalledTimes(2)
  })

  it('recovers a timed-out expiration only after a fresh read confirms expiry', async () => {
    const { stripe, retrieve, expire } = mockStripe()
    expire.mockRejectedValue(new Error('Network timeout'))
    retrieve.mockResolvedValueOnce(openSession).mockResolvedValueOnce(expiredSession)
    expect(await reuseOrExpireCheckoutSession(stripe, openSession.id, owner)).toBe(expiredSession)
    expect(retrieve).toHaveBeenCalledTimes(2)
  })

  it.each(['open', 'unavailable'])('retains the old claim when expiration is uncertain and retrieval is %s', async (state) => {
    const { stripe, retrieve, expire } = mockStripe()
    expire.mockRejectedValue(new Error('Network timeout'))
    retrieve.mockResolvedValueOnce(openSession)
    if (state === 'open') retrieve.mockResolvedValueOnce(openSession)
    else retrieve.mockRejectedValueOnce(new Error('Stripe unavailable'))
    await expect(reuseOrExpireCheckoutSession(stripe, openSession.id, owner)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects an unconfirmed expiration response', async () => {
    const { stripe, expire } = mockStripe()
    expire.mockResolvedValue(openSession)
    await expect(reuseOrExpireCheckoutSession(stripe, openSession.id, owner)).rejects.toMatchObject({ statusCode: 503 })
  })
})

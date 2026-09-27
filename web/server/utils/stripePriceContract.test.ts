import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { assertStripePriceMatchesPlan, resolveStripePriceIds } from './stripePriceContract'

beforeEach(() => {
  vi.stubGlobal('createError', ({ message }: { message: string }) => new Error(message))
})

function price(extraCents: number) {
  return {
    active: true,
    type: 'recurring',
    currency: 'usd',
    billing_scheme: 'tiered',
    tiers_mode: 'graduated',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    tiers: [
      { up_to: 150, flat_amount: 4900, unit_amount: 0 },
      { up_to: null, flat_amount: 0, unit_amount: extraCents },
    ],
  } as Stripe.Price
}

describe('configured Stripe price contract', () => {
  it('replaces only the known archived live Pro price across billing paths', () => {
    expect(resolveStripePriceIds({
      stripePriceFlexible: 'price_flexible',
      stripePricePro: 'price_1TtJ9NRu9PxBJUvyU8TsUSvX',
      stripePriceScale: 'price_scale',
    })).toEqual({
      flexible: 'price_flexible',
      pro: 'price_1UKPCFRu9PxBJUvyd5HMupyP',
      scale: 'price_scale',
    })
    expect(resolveStripePriceIds({
      stripePriceFlexible: 'price_flexible',
      stripePricePro: 'price_test_pro',
      stripePriceScale: 'price_scale',
    }).pro).toBe('price_test_pro')
  })

  it('accepts the Pro price only when its Stripe marginal charge matches the customer quote', async () => {
    const retrieve = vi.fn().mockResolvedValueOnce(price(50)).mockResolvedValueOnce(price(5000))
    const stripe = { prices: { retrieve } } as unknown as Stripe
    await expect(assertStripePriceMatchesPlan(stripe, 'pro', 'price_pro')).resolves.toBeUndefined()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(assertStripePriceMatchesPlan(stripe, 'pro', 'price_pro'))
        .rejects.toThrow('temporarily unavailable')
    } finally {
      log.mockRestore()
    }
    expect(retrieve).toHaveBeenCalledWith('price_pro', { expand: ['tiers'] })
  })
})

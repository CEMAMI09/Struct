import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { getBillingPortalConfiguration } from './portal'

beforeEach(() => {
  vi.stubGlobal('createError', ({ message }: { message: string }) => new Error(message))
})

function stripeWithConfig(subscriptionUpdateEnabled: boolean) {
  const create = vi.fn()
  const update = vi.fn()
  const list = vi.fn(async () => ({ data: [{
    id: 'bpc_1', active: true,
    metadata: { struct: 'billing_portal_v3_reviewed_plan_changes' },
    features: {
      subscription_update: { enabled: subscriptionUpdateEnabled },
      subscription_cancel: { enabled: true },
    },
  }] }))
  const stripe = { billingPortal: { configurations: { list, create, update } } } as unknown as Stripe
  return { stripe, list, create, update }
}

describe('billing portal configuration', () => {
  it('uses only a reviewed safe config without mutating Stripe', async () => {
    const { stripe, create, update } = stripeWithConfig(false)
    expect((await getBillingPortalConfiguration(stripe)).id).toBe('bpc_1')
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('fails closed if plan changes remain enabled', async () => {
    const { stripe, create, update } = stripeWithConfig(true)
    await expect(getBillingPortalConfiguration(stripe)).rejects.toThrow('not set up')
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})

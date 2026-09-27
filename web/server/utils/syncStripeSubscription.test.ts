import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyStripeSubscriptionToOrg } from './syncStripeSubscription'

const prices = { flexible: 'price_flex', pro: 'price_pro', scale: 'price_scale' }

beforeEach(() => {
  vi.stubGlobal('createError', ({ message }: { message: string }) => new Error(message))
})

function fakeSubscription(id: string, customer = 'cus_1') {
  return {
    id,
    customer,
    status: 'active',
    metadata: { orgId: 'org_1' },
    items: { data: [
      { id: 'si_other', price: { id: 'price_other' }, quantity: 999 },
      { id: 'si_pro', price: { id: prices.pro }, quantity: 150 },
    ] },
  } as unknown as Stripe.Subscription
}

function fakeDb(linkedSubscriptionId: string | null = 'sub_linked', updateWon = true) {
  const updatedQuery: any = {
    eq: vi.fn(() => updatedQuery),
    is: vi.fn(() => updatedQuery),
    select: vi.fn(() => updatedQuery),
    maybeSingle: vi.fn(async () => ({ data: updateWon ? { id: 'org_1' } : null, error: null })),
  }
  const update = vi.fn(() => updatedQuery)
  const query: any = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: {
      id: 'org_1', stripe_customer_id: 'cus_1', stripe_subscription_id: linkedSubscriptionId,
      stripe_quantity: 5, subscription_tier: 'flexible',
    }, error: null }),
    update,
  }
  const db = { from: vi.fn(() => query) } as unknown as SupabaseClient
  return { db, update, updatedQuery }
}

describe('subscription reconciliation', () => {
  it('ignores an unsolicited sibling even when it has a larger quantity', async () => {
    const { db, update } = fakeDb()
    expect(await applyStripeSubscriptionToOrg(db, fakeSubscription('sub_other'), prices, 'org_1')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('counts only the configured Struct price item', async () => {
    const { db, update } = fakeDb()
    const result = await applyStripeSubscriptionToOrg(db, fakeSubscription('sub_linked'), prices, 'org_1')
    expect(result?.stripeQuantity).toBe(150)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      stripe_item_id: 'si_pro', stripe_quantity: 150, subscription_tier: 'pro',
    }))
  })

  it('rejects a different Stripe customer', async () => {
    const { db, update } = fakeDb()
    await expect(applyStripeSubscriptionToOrg(db, fakeSubscription('sub_linked', 'cus_other'), prices, 'org_1'))
      .rejects.toThrow('customer does not match')
    expect(update).not.toHaveBeenCalled()
  })

  it('does not grant capacity for a subscription awaiting its first payment', async () => {
    const { db, update } = fakeDb()
    const subscription = fakeSubscription('sub_linked')
    subscription.status = 'incomplete'
    expect(await applyStripeSubscriptionToOrg(db, subscription, prices, 'org_1')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('adopts a paid Checkout only for an unlinked organization', async () => {
    const { db, update, updatedQuery } = fakeDb(null)
    expect(await applyStripeSubscriptionToOrg(db, fakeSubscription('sub_new'), prices, 'org_1')).toBeNull()
    expect(update).not.toHaveBeenCalled()
    const result = await applyStripeSubscriptionToOrg(db, fakeSubscription('sub_new'), prices, 'org_1', true)
    expect(result?.subscriptionTier).toBe('pro')
    expect(updatedQuery.is).toHaveBeenCalledWith('stripe_subscription_id', null)
  })

  it('does not let another completed Checkout replace a linked paid subscription', async () => {
    const { db, update } = fakeDb()
    expect(await applyStripeSubscriptionToOrg(db, fakeSubscription('sub_other'), prices, 'org_1', true)).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('does not grant an upgraded price while payment is past due', async () => {
    const { db, update } = fakeDb()
    const subscription = fakeSubscription('sub_linked')
    subscription.status = 'past_due'
    expect(await applyStripeSubscriptionToOrg(db, subscription, prices, 'org_1')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('does not report success when another billing update won the database race', async () => {
    const { db } = fakeDb(null, false)
    expect(await applyStripeSubscriptionToOrg(db, fakeSubscription('sub_new'), prices, 'org_1', true)).toBeNull()
  })

  it('flags subscriptions containing two Struct plan prices for review', async () => {
    const { db, update } = fakeDb()
    const subscription = fakeSubscription('sub_linked')
    subscription.items.data.push({ id: 'si_scale', price: { id: prices.scale }, quantity: 1000 } as Stripe.SubscriptionItem)
    await expect(applyStripeSubscriptionToOrg(db, subscription, prices, 'org_1'))
      .rejects.toThrow('exactly one configured Struct price')
    expect(update).not.toHaveBeenCalled()
  })
})

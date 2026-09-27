import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrganizationBillingRow } from './billing'
import { ensureOrganizationStripeCustomer } from './stripeCustomer'

beforeEach(() => {
  vi.stubGlobal('createError', ({ message }: { message: string }) => new Error(message))
})

const org: OrganizationBillingRow = {
  id: 'org_1', subscription_tier: 'free', stripe_customer_id: null,
  stripe_subscription_id: null, stripe_item_id: null, stripe_quantity: 0,
}

describe('organization Stripe customer', () => {
  it('returns the persisted winner when portal and checkout race to create a customer', async () => {
    const create = vi.fn(async () => ({ id: 'cus_created' }))
    const stripe = { customers: { create } } as unknown as Stripe
    const query: any = {
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      is: vi.fn(async () => ({ error: null })),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: { ...org, stripe_customer_id: 'cus_winner' }, error: null })),
    }
    const db = { from: vi.fn(() => query) } as unknown as SupabaseClient

    expect(await ensureOrganizationStripeCustomer(db, stripe, org)).toBe('cus_winner')
    expect(create).toHaveBeenCalledWith(
      { metadata: { orgId: org.id } },
      { idempotencyKey: `struct:customer:v1:${org.id}` },
    )
    expect(query.is).toHaveBeenCalledWith('stripe_customer_id', null)
  })

  it('reuses the linked customer without creating another', async () => {
    const create = vi.fn()
    const stripe = { customers: { create } } as unknown as Stripe
    const db = { from: vi.fn() } as unknown as SupabaseClient
    expect(await ensureOrganizationStripeCustomer(db, stripe, { ...org, stripe_customer_id: 'cus_linked' }))
      .toBe('cus_linked')
    expect(create).not.toHaveBeenCalled()
    expect(db.from).not.toHaveBeenCalled()
  })
})

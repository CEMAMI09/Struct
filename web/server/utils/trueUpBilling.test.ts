import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UsagePeriodRow } from './usagePeriods'
import { processClosedUsagePeriods, processPeriodTrueUp } from './trueUpBilling'

const period: UsagePeriodRow = {
  id: 'period_1',
  organization_id: 'org_1',
  stripe_subscription_id: 'sub_1',
  stripe_period_start: '2026-08-01T00:00:00.000Z',
  stripe_period_end: '2026-09-01T00:00:00.000Z',
  tier: 'pro',
  included_paid_quantity: 150,
  peak_device_count: 165,
  peak_paid_quantity: 160,
  true_up_amount_cents: null,
  true_up_invoice_item_id: null,
  status: 'open',
}

beforeEach(() => {
  vi.stubGlobal('createError', ({ message }: { message: string }) => new Error(message))
})

function harness(options: { failFirstCompletion?: boolean; existingOnRetry?: boolean; claimedPeriod?: UsagePeriodRow } = {}) {
  let completions = 0
  let lists = 0
  const rpc = vi.fn(async (name: string) => {
    if (name === 'claim_org_usage_true_up') return { data: options.claimedPeriod || period, error: null }
    if (name === 'complete_org_usage_true_up') {
      completions++
      return { data: period, error: options.failFirstCompletion && completions === 1
        ? { message: 'database unavailable' } : null }
    }
    if (name === 'release_org_usage_true_up') return { data: true, error: null }
    throw new Error(`Unknown RPC ${name}`)
  })
  const orgQuery: any = {
    select: () => orgQuery,
    eq: () => orgQuery,
    maybeSingle: async () => ({ data: { stripe_customer_id: 'cus_1' }, error: null }),
  }
  const db = {
    rpc,
    from: vi.fn(() => orgQuery),
  } as unknown as SupabaseClient
  const list = vi.fn(async () => {
    lists++
    return {
      data: options.existingOnRetry && lists > 1
        ? [{ id: 'ii_1', amount: 500, metadata: { usagePeriodId: period.id } }] : [],
      has_more: false,
    }
  })
  const create = vi.fn(async () => ({ id: 'ii_1', amount: 500 }))
  const stripe = { invoiceItems: { list, create } } as unknown as Stripe
  return { db, stripe, rpc, list, create }
}

describe('usage true-up', () => {
  it('adds one explicitly targeted invoice item with a deterministic key', async () => {
    const { db, stripe, rpc, create } = harness()
    const result = await processPeriodTrueUp(db, stripe, period, 'in_1')
    expect(result).toEqual({ amountCents: 500, overageQty: 10, invoiceItemId: 'ii_1' })
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: 'in_1', customer: 'cus_1', amount: 500,
        metadata: expect.objectContaining({ usagePeriodId: period.id }) }),
      { idempotencyKey: 'struct:true-up:v1:period_1:in_1' },
    )
    expect(rpc).toHaveBeenCalledWith('complete_org_usage_true_up', expect.objectContaining({
      p_invoice_item_id: 'ii_1', p_amount_cents: 500,
    }))
  })

  it('reconciles an existing Stripe item after the database completion fails', async () => {
    const { db, stripe, rpc, create } = harness({ failFirstCompletion: true, existingOnRetry: true })
    await expect(processPeriodTrueUp(db, stripe, period, 'in_1')).rejects.toThrow('database unavailable')
    const result = await processPeriodTrueUp(db, stripe, period, 'in_1')
    expect(result?.invoiceItemId).toBe('ii_1')
    expect(create).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('release_org_usage_true_up', expect.anything())
  })

  it('closes zero-overage periods without touching Stripe', async () => {
    const { db, stripe, rpc, list, create } = harness({
      claimedPeriod: { ...period, peak_paid_quantity: 150 },
    })
    await processPeriodTrueUp(db, stripe, { ...period, peak_paid_quantity: 150 }, 'in_1')
    expect(list).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('complete_org_usage_true_up', expect.objectContaining({
      p_invoice_item_id: null, p_amount_cents: 0,
    }))
  })

  it('selects closed calendar periods, not the new subscription period', async () => {
    const { db, stripe } = harness()
    const query: any = {
      select: () => query,
      eq: () => query,
      lte: vi.fn(() => query),
      order: () => query,
      limit: async () => ({ data: [], error: null }),
    }
    vi.spyOn(db, 'from').mockReturnValue(query)
    await processClosedUsagePeriods(db, stripe, 'org_1', 'in_1', new Date('2026-09-20T00:00:00.000Z'))
    expect(query.lte).toHaveBeenCalledWith('stripe_period_end', '2026-09-20T00:00:00.000Z')
  })
})

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
  true_up_baseline_verified: true,
  status: 'open',
}

beforeEach(() => {
  vi.stubGlobal('createError', ({ message }: { message: string }) => new Error(message))
})

function harness(options: {
  failFirstCompletion?: boolean
  existingOnRetry?: boolean
  existingAmount?: number
  claimedPeriod?: UsagePeriodRow
} = {}) {
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
        ? [{ id: 'ii_1', amount: options.existingAmount ?? 500, currency: 'usd', invoice: 'in_1',
          metadata: { usagePeriodId: period.id } }] : [],
      has_more: false,
    }
  })
  const create = vi.fn(async () => ({ id: 'ii_1', amount: 500, currency: 'usd', invoice: 'in_1' }))
  const stripe = { invoiceItems: { list, create } } as unknown as Stripe
  return { db, stripe, rpc, list, create }
}

function mockDuePeriods(
  db: SupabaseClient,
  verified: UsagePeriodRow[],
  unverified: UsagePeriodRow[] = [],
) {
  const lte = vi.fn()
  vi.spyOn(db, 'from').mockImplementation((table) => {
    if (table === 'organizations') {
      const orgQuery: any = {
        select: () => orgQuery,
        eq: () => orgQuery,
        maybeSingle: async () => ({ data: { stripe_customer_id: 'cus_1' }, error: null }),
      }
      return orgQuery
    }
    let baselineVerified: boolean | null = null
    const query: any = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        if (column === 'true_up_baseline_verified') baselineVerified = value as boolean
        return query
      },
      neq: () => query,
      lt: () => query,
      gt: () => query,
      lte: (column: string, value: string) => {
        lte(column, value)
        return query
      },
      order: () => query,
      limit: (count: number) => baselineVerified === null
        ? query
        : Promise.resolve({ data: (baselineVerified ? verified : unverified).slice(0, count), error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
    }
    return query
  })
  return { lte }
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

  it('refuses to close a period against an existing item with a different charge', async () => {
    const { db, stripe, create } = harness({
      failFirstCompletion: true, existingOnRetry: true, existingAmount: 1000,
    })
    await expect(processPeriodTrueUp(db, stripe, period, 'in_1')).rejects.toThrow('database unavailable')
    await expect(processPeriodTrueUp(db, stripe, period, 'in_1')).rejects.toThrow('amount needs billing reconciliation')
    expect(create).toHaveBeenCalledOnce()
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
    const { lte } = mockDuePeriods(db, [])
    await processClosedUsagePeriods(db, stripe, 'org_1', 'in_1', new Date('2026-09-20T00:00:00.000Z'))
    expect(lte).toHaveBeenCalledWith('stripe_period_end', '2026-09-20T00:00:00.000Z')
  })

  it('asks Stripe to retry when more due periods remain after one batch', async () => {
    const { db, stripe, rpc } = harness({ claimedPeriod: { ...period, tier: 'free' } })
    const duePeriods = Array.from({ length: 101 }, (_, index) => ({ ...period, id: `period_${index}` }))
    mockDuePeriods(db, duePeriods)
    await expect(processClosedUsagePeriods(db, stripe, 'org_1', 'in_1'))
      .rejects.toThrow('More usage periods require true-up processing')
    expect(rpc.mock.calls.filter(([name]) => name === 'complete_org_usage_true_up')).toHaveLength(100)
  })

  it('charges a verified month before surfacing unresolved historical periods', async () => {
    const { db, stripe, rpc, create } = harness()
    const historical = [
      { ...period, id: 'period_old_1', true_up_baseline_verified: false },
      { ...period, id: 'period_old_2', true_up_baseline_verified: false },
    ]
    mockDuePeriods(db, [period], historical)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(processClosedUsagePeriods(db, stripe, 'org_1', 'in_1'))
        .rejects.toThrow('USAGE_BASELINE_RECONCILIATION_REQUIRED')
      expect(create).toHaveBeenCalledOnce()
      expect(rpc).toHaveBeenCalledWith('complete_org_usage_true_up', expect.anything())
      expect(log).toHaveBeenCalledWith(
        '[stripe true-up] USAGE_BASELINE_RECONCILIATION_REQUIRED',
        expect.objectContaining({
          orgId: 'org_1', invoiceId: 'in_1', periodIds: ['period_old_1', 'period_old_2'],
        }),
      )
    } finally {
      log.mockRestore()
    }
  })
})

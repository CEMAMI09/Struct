import { describe, expect, it } from 'vitest'
import { planCapacityForProjectedCount } from './deviceCapacity'
import type { OrganizationBillingRow } from './billing'

function org(partial: Partial<OrganizationBillingRow>): OrganizationBillingRow {
  return {
    id: 'org-1',
    subscription_tier: 'pro',
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
    stripe_item_id: 'si_1',
    stripe_quantity: 150,
    ...partial,
  }
}

describe('planCapacityForProjectedCount', () => {
  it('records projected peak paid quantity without Stripe mutation flag semantics', () => {
    const plan = planCapacityForProjectedCount(org({ subscription_tier: 'pro', stripe_quantity: 150 }), 150, 10)
    expect(plan.projectedCount).toBe(160)
    expect(plan.projectedPeakPaidQuantity).toBeGreaterThanOrEqual(155)
    expect(plan.needsUsageUpdate).toBe(true)
  })

  it('does not shrink peak on projected deletes', () => {
    const openPeriod = {
      id: 'p1',
      organization_id: 'org-1',
      stripe_subscription_id: 'sub_1',
      stripe_period_start: new Date().toISOString(),
      stripe_period_end: new Date().toISOString(),
      tier: 'pro' as const,
      included_paid_quantity: 150,
      peak_device_count: 200,
      peak_paid_quantity: 195,
      true_up_amount_cents: null,
      true_up_invoice_item_id: null,
      true_up_baseline_verified: true,
      status: 'open' as const,
    }
    const plan = planCapacityForProjectedCount(org({ subscription_tier: 'pro' }), 180, -5, openPeriod)
    expect(plan.projectedPeakDeviceCount).toBe(200)
  })

  it('does not quote overage for devices already paid in Stripe', () => {
    const paidOrg = org({ stripe_quantity: 170 })
    const withinPaidCapacity = planCapacityForProjectedCount(paidOrg, 170, 5)
    expect(withinPaidCapacity.includedPaidQuantity).toBe(170)
    expect(withinPaidCapacity.projectedPeakPaidQuantity).toBe(170)
    expect(withinPaidCapacity.overageDelta).toBe(0)
    expect(withinPaidCapacity.estimatedTrueUpCents).toBe(0)

    const overPaidCapacity = planCapacityForProjectedCount(paidOrg, 175, 5)
    expect(overPaidCapacity.projectedPeakPaidQuantity).toBe(175)
    expect(overPaidCapacity.currentPeakPaidQuantity).toBe(170)
    expect(overPaidCapacity.overageDelta).toBe(5)
    expect(overPaidCapacity.estimatedTrueUpCents).toBe(250)
  })

  it('preserves the higher paid baseline in the open monthly ledger', () => {
    const openPeriod = {
      id: 'p2',
      organization_id: 'org-1',
      stripe_subscription_id: 'sub_1',
      stripe_period_start: new Date().toISOString(),
      stripe_period_end: new Date().toISOString(),
      tier: 'pro' as const,
      included_paid_quantity: 190,
      peak_device_count: 180,
      peak_paid_quantity: 190,
      true_up_amount_cents: null,
      true_up_invoice_item_id: null,
      true_up_baseline_verified: true,
      status: 'open' as const,
    }
    const plan = planCapacityForProjectedCount(org({ stripe_quantity: 170 }), 180, 10, openPeriod)
    expect(plan.includedPaidQuantity).toBe(190)
    expect(plan.projectedPeakPaidQuantity).toBe(190)
    expect(plan.currentPeakPaidQuantity).toBe(190)
    expect(plan.overageDelta).toBe(0)
    expect(plan.estimatedTrueUpCents).toBe(0)
  })
})

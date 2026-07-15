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
      status: 'open' as const,
    }
    const plan = planCapacityForProjectedCount(org({ subscription_tier: 'pro' }), 180, -5, openPeriod)
    expect(plan.projectedPeakDeviceCount).toBe(200)
  })
})

import { describe, expect, it } from 'vitest'
import { getRequiredQuantity, type OrganizationBillingRow } from './billing'
import { planCapacityForProjectedCount } from './deviceCapacity'

function org(
  overrides: Partial<OrganizationBillingRow> = {},
): OrganizationBillingRow {
  return {
    id: 'org-1',
    subscription_tier: 'flexible',
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
    stripe_item_id: 'si_1',
    stripe_quantity: 5,
    ...overrides,
  }
}

describe('planCapacityForProjectedCount', () => {
  it('keeps quantity at the flexible floor when still within included devices', () => {
    const plan = planCapacityForProjectedCount(org(), 2, 3)
    expect(plan.projectedCount).toBe(5)
    expect(plan.targetQuantity).toBe(5)
    expect(plan.quantityDelta).toBe(0)
    expect(plan.needsStripeUpdate).toBe(false)
  })

  it('scales Stripe quantity for bulk uploads beyond the current limit', () => {
    // free pool 5 + quantity 5 = limit 10. current 2 + new 500 = 502
    // required = max(5, 502 - 5) = 497
    const plan = planCapacityForProjectedCount(org({ stripe_quantity: 5 }), 2, 500)
    expect(plan.projectedCount).toBe(502)
    expect(plan.targetQuantity).toBe(497)
    expect(plan.quantityDelta).toBe(492)
    expect(plan.needsStripeUpdate).toBe(true)
  })

  it('respects pro tier floor', () => {
    const plan = planCapacityForProjectedCount(
      org({ subscription_tier: 'pro', stripe_quantity: 150 }),
      10,
      20,
    )
    expect(getRequiredQuantity('pro', 30)).toBe(150)
    expect(plan.targetQuantity).toBe(150)
    expect(plan.needsStripeUpdate).toBe(false)
  })

  it('never lowers quantity during an upload', () => {
    const plan = planCapacityForProjectedCount(
      org({ subscription_tier: 'pro', stripe_quantity: 200 }),
      100,
      10,
    )
    expect(plan.targetQuantity).toBe(200)
    expect(plan.quantityDelta).toBe(0)
  })
})

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrganizationBillingRow } from './billing'
import {
  getActiveDeviceLimit,
  getOpenUsagePeriod,
  persistUsagePeak,
  planUsageForProjectedCount,
  resolveUsagePlan,
  type UsagePlan,
} from './usagePeriods'

export type { UsagePlan as CapacityPlan }

export function planCapacityForProjectedCount(
  org: OrganizationBillingRow,
  currentCount: number,
  newDeviceCount: number,
  openPeriod: Awaited<ReturnType<typeof getOpenUsagePeriod>> = null,
): UsagePlan {
  return planUsageForProjectedCount(org, currentCount, newDeviceCount, openPeriod)
}

export async function resolveCapacityPlan(
  supabase: SupabaseClient,
  orgId: string,
  newDeviceCount: number,
) {
  return resolveUsagePlan(supabase, orgId, newDeviceCount)
}

export async function recordCapacityUsage(
  supabase: SupabaseClient,
  orgId: string,
  activeDeviceCount: number,
) {
  return persistUsagePeak(supabase, orgId, activeDeviceCount)
}

export function getProjectedDeviceLimit(
  org: OrganizationBillingRow,
  peakPaidQuantity?: number,
) {
  return getActiveDeviceLimit(org, peakPaidQuantity)
}

/** @deprecated Stripe quantity is no longer mutated mid-cycle. */
export async function applyStripeQuantity() {
  throw createError({
    statusCode: 500,
    message: 'Mid-cycle Stripe quantity updates are disabled — billing uses monthly true-up.',
  })
}

/** @deprecated */
export async function restoreStripeQuantity() {
  return
}

/** @deprecated */
export async function persistStripeQuantity() {
  return
}

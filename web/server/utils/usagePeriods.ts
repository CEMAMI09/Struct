import type { SupabaseClient } from '@supabase/supabase-js'
import { TIER_FLOORS, type OrganizationBillingRow, type SubscriptionTier } from './billing'
import { countOrganizationDevices, getOrganizationBilling } from './organizations'

export interface UsagePeriodRow {
  id: string
  organization_id: string
  stripe_subscription_id: string | null
  stripe_period_start: string
  stripe_period_end: string
  tier: SubscriptionTier
  included_paid_quantity: number
  peak_device_count: number
  peak_paid_quantity: number
  true_up_amount_cents: number | null
  true_up_invoice_item_id: string | null
  status: 'open' | 'invoiced' | 'void'
}

export interface UsagePlan {
  org: OrganizationBillingRow
  currentCount: number
  projectedCount: number
  includedPaidQuantity: number
  currentPeakDeviceCount: number
  projectedPeakDeviceCount: number
  projectedPeakPaidQuantity: number
  overageDelta: number
  needsUsageUpdate: boolean
  estimatedTrueUpCents: number
  currency: string
}

const TIER_OVERAGE_RATE_CENTS: Record<SubscriptionTier, number> = {
  free: 0,
  flexible: 100,
  pro: 50,
  scale: 20,
}

export function getIncludedPaidQuantity(tier: SubscriptionTier) {
  return TIER_FLOORS[tier]
}

export function getActiveDeviceLimit(org: OrganizationBillingRow, peakPaidQuantity = 0) {
  const floor = getIncludedPaidQuantity(org.subscription_tier)
  const paid = Math.max(floor, peakPaidQuantity, org.stripe_quantity)
  return 5 + paid
}

export async function getOpenUsagePeriod(
  supabase: SupabaseClient,
  orgId: string,
): Promise<UsagePeriodRow | null> {
  const { data, error } = await supabase
    .from('organization_device_usage_periods')
    .select('*')
    .eq('organization_id', orgId)
    .eq('status', 'open')
    .order('stripe_period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
  return (data as UsagePeriodRow | null) || null
}

export async function recordUsagePeak(
  supabase: SupabaseClient,
  orgId: string,
  activeDeviceCount: number,
) {
  const { data, error } = await supabase.rpc('record_org_device_peak', {
    p_org_id: orgId,
    p_active_device_count: activeDeviceCount,
  })

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
  return data as UsagePeriodRow
}

export function planUsageForProjectedCount(
  org: OrganizationBillingRow,
  currentCount: number,
  newDeviceCount: number,
  openPeriod: UsagePeriodRow | null,
): UsagePlan {
  const projectedCount = currentCount + newDeviceCount
  const includedPaidQuantity = getIncludedPaidQuantity(org.subscription_tier)
  const currentPeakDeviceCount = openPeriod?.peak_device_count ?? currentCount
  const projectedPeakDeviceCount = Math.max(currentPeakDeviceCount, projectedCount)
  const projectedPeakPaidQuantity = Math.max(
    includedPaidQuantity,
    projectedPeakDeviceCount - 5,
  )
  const currentPeakPaidQuantity = openPeriod?.peak_paid_quantity ?? includedPaidQuantity
  const overageDelta = Math.max(0, projectedPeakPaidQuantity - currentPeakPaidQuantity)
  const rate = TIER_OVERAGE_RATE_CENTS[org.subscription_tier]
  const estimatedTrueUpCents = Math.max(
    0,
    (projectedPeakPaidQuantity - includedPaidQuantity) * rate,
  )

  return {
    org,
    currentCount,
    projectedCount,
    includedPaidQuantity,
    currentPeakDeviceCount,
    projectedPeakDeviceCount,
    projectedPeakPaidQuantity,
    overageDelta,
    needsUsageUpdate: projectedPeakDeviceCount > currentPeakDeviceCount,
    estimatedTrueUpCents,
    currency: 'usd',
  }
}

export async function resolveUsagePlan(
  supabase: SupabaseClient,
  orgId: string,
  newDeviceCount: number,
) {
  const org = await getOrganizationBilling(supabase, orgId)
  const currentCount = await countOrganizationDevices(supabase, orgId)
  const openPeriod = await getOpenUsagePeriod(supabase, orgId)
  const plan = planUsageForProjectedCount(org, currentCount, newDeviceCount, openPeriod)
  const activeLimit = getActiveDeviceLimit(org, openPeriod?.peak_paid_quantity)

  if (plan.projectedCount > activeLimit && org.subscription_tier === 'free') {
    throw createError({
      statusCode: 402,
      statusMessage: 'Payment Required',
      message: `Free tier supports up to 5 devices. This upload would reach ${plan.projectedCount}. Upgrade to add more.`,
    })
  }

  if (plan.projectedCount > activeLimit && org.subscription_tier !== 'free') {
    if (!org.stripe_customer_id || !org.stripe_subscription_id) {
      throw createError({
        statusCode: 402,
        statusMessage: 'Payment Required',
        message:
          'Paid plan is missing Stripe billing details. Open Billing settings to fix your plan.',
      })
    }
  }

  return plan
}

export async function persistUsagePeak(
  supabase: SupabaseClient,
  orgId: string,
  activeDeviceCount: number,
) {
  return recordUsagePeak(supabase, orgId, activeDeviceCount)
}

export function estimateTrueUpCents(
  tier: SubscriptionTier,
  includedPaidQuantity: number,
  peakPaidQuantity: number,
) {
  const rate = TIER_OVERAGE_RATE_CENTS[tier]
  return Math.max(0, (peakPaidQuantity - includedPaidQuantity) * rate)
}

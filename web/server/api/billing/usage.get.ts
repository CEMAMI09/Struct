import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import { getOrganizationBilling } from '../../utils/organizations'
import {
  getActiveDeviceLimit,
  getIncludedPaidQuantity,
  getOpenUsagePeriod,
} from '../../utils/usagePeriods'

export default defineEventHandler(async (event) => {
  const orgId = String(getQuery(event).orgId || '').trim()
  if (!orgId) {
    throw createError({ statusCode: 400, message: 'orgId is required' })
  }

  await requireOrgWriter(event, orgId)
  const supabase = await serverSupabaseServiceRole(event)
  const org = await getOrganizationBilling(supabase, orgId)
  const openPeriod = await getOpenUsagePeriod(supabase, orgId)
  const includedPaidQuantity = getIncludedPaidQuantity(org.subscription_tier)
  const peakPaidQuantity = openPeriod?.peak_paid_quantity ?? includedPaidQuantity

  return {
    peakDeviceCount: openPeriod?.peak_device_count ?? 0,
    peakPaidQuantity,
    includedPaidQuantity,
    deviceLimit: getActiveDeviceLimit(org, peakPaidQuantity),
    periodStart: openPeriod?.stripe_period_start ?? null,
    periodEnd: openPeriod?.stripe_period_end ?? null,
    estimatedTrueUpCents: openPeriod?.true_up_amount_cents ?? null,
  }
})

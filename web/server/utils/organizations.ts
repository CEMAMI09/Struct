import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrganizationBillingRow } from './billing'

export async function getOrganizationBilling(
  supabase: SupabaseClient,
  orgId: string,
) {
  const { data, error } = await supabase
    .from('organizations')
    .select(
      'id, subscription_tier, stripe_customer_id, stripe_subscription_id, stripe_item_id, stripe_quantity',
    )
    .eq('id', orgId)
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
  if (!data) {
    throw createError({ statusCode: 404, message: 'Organization not found' })
  }

  return data as OrganizationBillingRow
}

export async function countOrganizationDevices(
  supabase: SupabaseClient,
  orgId: string,
) {
  const { count, error } = await supabase
    .from('devices')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }

  return count || 0
}

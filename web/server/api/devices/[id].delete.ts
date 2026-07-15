import { serverSupabaseServiceRole } from '#supabase/server'
import { getRequiredQuantity, isPaidTier } from '../../utils/billing'
import { requireOrgWriter } from '../../utils/auth'
import {
  countOrganizationDevices,
  getOrganizationBilling,
} from '../../utils/organizations'
import { useStripeClient } from '../../utils/stripe'

async function scaleDownIfNeeded(
  supabase: Awaited<ReturnType<typeof serverSupabaseServiceRole>>,
  orgId: string,
) {
  const org = await getOrganizationBilling(supabase, orgId)
  if (!isPaidTier(org.subscription_tier) || !org.stripe_item_id) {
    return
  }

  const remainingDevices = await countOrganizationDevices(supabase, orgId)
  const requiredQuantity = getRequiredQuantity(org.subscription_tier, remainingDevices)

  if (requiredQuantity >= org.stripe_quantity) {
    return
  }

  const stripe = useStripeClient()
  await stripe.subscriptionItems.update(org.stripe_item_id, {
    quantity: requiredQuantity,
    proration_behavior: 'create_prorations',
  })

  const { error } = await supabase
    .from('organizations')
    .update({ stripe_quantity: requiredQuantity })
    .eq('id', orgId)

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }
}

export default defineEventHandler(async (event) => {
  const deviceId = getRouterParam(event, 'id')?.trim()
  const query = getQuery(event)
  const orgId = String(query.orgId || '').trim()

  if (!deviceId || !orgId) {
    throw createError({ statusCode: 400, message: 'device id and orgId are required' })
  }

  await requireOrgWriter(event, orgId)
  const serviceSupabase = await serverSupabaseServiceRole(event)

  const { data: device, error: lookupError } = await serviceSupabase
    .from('devices')
    .select('id, organization_id')
    .eq('id', deviceId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (lookupError) {
    throw createError({ statusCode: 500, message: lookupError.message })
  }
  if (!device) {
    throw createError({ statusCode: 404, message: 'Device not found' })
  }

  const { error: deleteError } = await serviceSupabase
    .from('devices')
    .delete()
    .eq('id', deviceId)
    .eq('organization_id', orgId)

  if (deleteError) {
    throw createError({ statusCode: 500, message: deleteError.message })
  }

  await scaleDownIfNeeded(serviceSupabase, orgId)

  return { ok: true }
})

import { serverSupabaseServiceRole } from '#supabase/server'
import {
  getDeviceLimit,
  getRequiredQuantity,
  isPaidTier,
} from '../../utils/billing'
import { requireOrgWriter } from '../../utils/auth'
import {
  countOrganizationDevices,
  getOrganizationBilling,
} from '../../utils/organizations'
import { useStripeClient } from '../../utils/stripe'

function randomApiKey() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let key = ''
  for (let i = 0; i < 16; i++) {
    key += alphabet[bytes[i]! % alphabet.length]
  }
  return key
}

async function scaleUpIfNeeded(
  supabase: Awaited<ReturnType<typeof serverSupabaseServiceRole>>,
  orgId: string,
) {
  const org = await getOrganizationBilling(supabase, orgId)
  const currentCount = await countOrganizationDevices(supabase, orgId)
  const limit = getDeviceLimit(org.stripe_quantity)

  if (currentCount < limit) {
    return org
  }

  if (!isPaidTier(org.subscription_tier)) {
    throw createError({
      statusCode: 402,
      statusMessage: 'Payment Required',
      message: 'Free tier supports up to 5 devices. Upgrade to add more.',
    })
  }

  if (!org.stripe_item_id) {
    throw createError({
      statusCode: 402,
      statusMessage: 'Payment Required',
      message: 'Paid plan is missing a Stripe subscription item. Open billing to fix your plan.',
    })
  }

  const nextQuantity = org.stripe_quantity + 1
  const stripe = useStripeClient()

  await stripe.subscriptionItems.update(org.stripe_item_id, {
    quantity: nextQuantity,
    proration_behavior: 'create_prorations',
  })

  const { error } = await supabase
    .from('organizations')
    .update({ stripe_quantity: nextQuantity })
    .eq('id', orgId)

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }

  return {
    ...org,
    stripe_quantity: nextQuantity,
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string; orgId?: string }>(event)
  const name = body?.name?.trim()
  const orgId = body?.orgId?.trim()

  if (!name || !orgId) {
    throw createError({ statusCode: 400, message: 'name and orgId are required' })
  }

  const { user } = await requireOrgWriter(event, orgId)
  const serviceSupabase = await serverSupabaseServiceRole(event)

  await scaleUpIfNeeded(serviceSupabase, orgId)

  const apiKey = randomApiKey()
  const { data: device, error: deviceError } = await serviceSupabase
    .from('devices')
    .insert({
      name,
      api_key: apiKey,
      user_id: user.id,
      organization_id: orgId,
      tags: {},
      encryption_enabled: false,
    })
    .select()
    .single()

  if (deviceError) {
    throw createError({ statusCode: 500, message: deviceError.message })
  }

  const { error: schemaError } = await serviceSupabase.from('schemas').insert({
    device_id: device.id,
    organization_id: orgId,
    schema_definition: [],
    version: 1,
  })

  if (schemaError) {
    await serviceSupabase.from('devices').delete().eq('id', device.id)
    throw createError({ statusCode: 500, message: schemaError.message })
  }

  const { error: versionError } = await serviceSupabase.from('schema_versions').insert({
    device_id: device.id,
    version: 1,
    schema_definition: [],
  })

  if (versionError) {
    await serviceSupabase.from('devices').delete().eq('id', device.id)
    throw createError({ statusCode: 500, message: versionError.message })
  }

  return { device }
})

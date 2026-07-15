import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../utils/auth'
import { getOrganizationBilling } from '../../utils/organizations'
import { useStripeClient } from '../../utils/stripe'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ orgId?: string }>(event)
  const orgId = body?.orgId?.trim()

  if (!orgId) {
    throw createError({ statusCode: 400, message: 'orgId is required' })
  }

  await requireOrgWriter(event, orgId)

  const serviceSupabase = await serverSupabaseServiceRole(event)
  const org = await getOrganizationBilling(serviceSupabase, orgId)

  if (!org.stripe_customer_id) {
    throw createError({
      statusCode: 400,
      message: 'No Stripe customer on file — subscribe to a paid plan first',
    })
  }

  const stripe = useStripeClient()
  const origin = getRequestURL(event).origin

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${origin}/dashboard/settings`,
  })

  return { url: session.url }
})

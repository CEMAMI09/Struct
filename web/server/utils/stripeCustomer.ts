import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrganizationBillingRow } from './billing'
import { getOrganizationBilling } from './organizations'

/** Checkout and portal must converge on one persisted customer even when
 * opened concurrently by different administrators. */
export async function ensureOrganizationStripeCustomer(
  supabase: SupabaseClient,
  stripe: Stripe,
  org: OrganizationBillingRow,
) {
  if (org.stripe_customer_id) return org.stripe_customer_id

  const customer = await stripe.customers.create(
    { metadata: { orgId: org.id } },
    { idempotencyKey: `struct:customer:v1:${org.id}` },
  )
  const { error } = await supabase.from('organizations')
    .update({ stripe_customer_id: customer.id })
    .eq('id', org.id)
    .is('stripe_customer_id', null)
  if (error) throw createError({ statusCode: 500, message: error.message })

  const persisted = await getOrganizationBilling(supabase, org.id)
  if (!persisted.stripe_customer_id) {
    throw createError({ statusCode: 503, message: 'Could not reserve a billing customer. Please retry.' })
  }
  return persisted.stripe_customer_id
}

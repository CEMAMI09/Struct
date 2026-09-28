import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export function isDefinitiveStripeFailure(error: unknown) {
  const type = (error as { type?: string } | null)?.type
  return ['StripeInvalidRequestError', 'StripeAuthenticationError',
    'StripePermissionError', 'StripeCardError', 'StripeRateLimitError'].includes(type || '')
}

/** Serialize Stripe reads/changes and their database commits for one org.
 * A mutation with an unknown outcome must retain the guard for reconciliation;
 * automatically expiring it could allow another charge while Stripe is working. */
export async function withOrgBillingLock<T>(
  supabase: SupabaseClient,
  orgId: string,
  run: (guard: { token: string; retain: () => void; startMutation: () => Promise<void> }) => Promise<T>,
  readOnly = true,
): Promise<T> {
  const token = randomUUID()
  const { data, error } = await supabase.rpc('claim_org_billing_operation', {
    p_org_id: orgId, p_claim_token: token, p_read_only: readOnly,
  })
  if (error) throw createError({ statusCode: 500, message: error.message })
  if (!data) throw createError({
    statusCode: 503,
    message: 'Billing is being synchronized. Retry shortly; contact support if this persists.',
  })
  let retained = false
  try {
    return await run({
      token, retain: () => { retained = true },
      startMutation: async () => {
        const { data: marked, error } = await supabase.rpc('mark_org_billing_mutation', {
          p_org_id: orgId, p_claim_token: token,
        })
        if (error || !marked) throw createError({ statusCode: 503, message: 'Billing operation could not be reserved. Please retry.' })
      },
    })
  } finally {
    if (!retained) {
      const { error: releaseError } = await supabase.rpc('release_org_billing_operation', {
        p_org_id: orgId, p_claim_token: token,
      })
      if (releaseError) {
        console.error('[stripe] billing guard needs reconciliation', { orgId, error: releaseError.message })
      }
    }
  }
}

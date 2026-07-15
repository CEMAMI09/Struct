import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../../utils/auth'
import {
  findConflictingMacs,
  formatMoney,
  normalizeAndValidateBulkPayload,
  QUOTE_TTL_MS,
} from '../../../utils/bulkDevices'
import {
  estimateProrationCents,
  resolveCapacityPlan,
} from '../../../utils/deviceCapacity'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ orgId?: string; devices?: unknown }>(event)
  const orgId = body?.orgId?.trim()
  if (!orgId) {
    throw createError({ statusCode: 400, message: 'orgId is required' })
  }

  const { user } = await requireOrgWriter(event, orgId)
  const { devices, payloadHash } = await normalizeAndValidateBulkPayload(body?.devices)

  const supabase = await serverSupabaseServiceRole(event)
  const conflicts = await findConflictingMacs(supabase, orgId, devices)
  if (conflicts.length) {
    throw createError({
      statusCode: 409,
      message: `MAC already exists in this organization: ${conflicts.slice(0, 5).join(', ')}${
        conflicts.length > 5 ? '…' : ''
      }`,
      data: { conflictingMacs: conflicts },
    })
  }

  const plan = await resolveCapacityPlan(supabase, orgId, devices.length)
  const estimate = plan.needsStripeUpdate
    ? await estimateProrationCents(plan.org, plan.targetQuantity)
    : { amount: 0, currency: 'usd' }

  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString()
  const stripeIdempotencyKey = `bulk-import:${orgId}:${payloadHash}`

  const { data: quote, error } = await supabase
    .from('bulk_device_imports')
    .insert({
      organization_id: orgId,
      user_id: user.id,
      payload_hash: payloadHash,
      devices,
      status: 'quoted',
      current_device_count: plan.currentCount,
      projected_device_count: plan.projectedCount,
      previous_stripe_quantity: plan.previousQuantity,
      target_stripe_quantity: plan.targetQuantity,
      estimated_proration_amount: estimate.amount,
      currency: estimate.currency,
      stripe_idempotency_key: stripeIdempotencyKey,
      expires_at: expiresAt,
    })
    .select(
      'id, organization_id, status, current_device_count, projected_device_count, previous_stripe_quantity, target_stripe_quantity, estimated_proration_amount, currency, expires_at',
    )
    .single()

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }

  return {
    importId: quote.id,
    expiresAt: quote.expires_at,
    deviceCount: devices.length,
    currentDeviceCount: quote.current_device_count,
    projectedDeviceCount: quote.projected_device_count,
    previousStripeQuantity: quote.previous_stripe_quantity,
    targetStripeQuantity: quote.target_stripe_quantity,
    quantityDelta: quote.target_stripe_quantity - quote.previous_stripe_quantity,
    estimatedProrationAmount: quote.estimated_proration_amount ?? 0,
    currency: quote.currency || 'usd',
    estimatedProrationFormatted: formatMoney(
      quote.estimated_proration_amount ?? 0,
      quote.currency || 'usd',
    ),
    needsStripeUpdate: plan.needsStripeUpdate,
    disclaimer:
      'Estimated prorated charge from Stripe. Tax and invoice timing can affect the final amount billed.',
  }
})

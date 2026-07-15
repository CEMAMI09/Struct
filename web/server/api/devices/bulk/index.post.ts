import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../../utils/auth'
import {
  findConflictingMacs,
  randomApiKey,
  type BulkDeviceInput,
  type BulkImportRow,
} from '../../../utils/bulkDevices'
import {
  applyStripeQuantity,
  persistStripeQuantity,
  resolveCapacityPlan,
  restoreStripeQuantity,
} from '../../../utils/deviceCapacity'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ orgId?: string; importId?: string }>(event)
  const orgId = body?.orgId?.trim()
  const importId = body?.importId?.trim()

  if (!orgId || !importId) {
    throw createError({ statusCode: 400, message: 'orgId and importId are required' })
  }

  await requireOrgWriter(event, orgId)
  const supabase = await serverSupabaseServiceRole(event)

  const { data: existing, error: lookupError } = await supabase
    .from('bulk_device_imports')
    .select('*')
    .eq('id', importId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (lookupError) {
    throw createError({ statusCode: 500, message: lookupError.message })
  }
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Bulk import quote not found' })
  }

  const quote = existing as BulkImportRow

  if (quote.status === 'completed') {
    const { data: devices, error: devicesError } = await supabase
      .from('devices')
      .select('*')
      .in('id', quote.created_device_ids || [])

    if (devicesError) {
      throw createError({ statusCode: 500, message: devicesError.message })
    }

    return {
      importId: quote.id,
      devices: devices || [],
      alreadyCompleted: true,
    }
  }

  if (quote.status === 'processing') {
    throw createError({
      statusCode: 409,
      message: 'This import is already processing. Wait a moment and refresh the fleet.',
    })
  }

  if (quote.status === 'failed' || quote.status === 'expired') {
    throw createError({
      statusCode: 409,
      message: 'This quote is no longer valid. Generate a new cost confirmation.',
      data: { refreshRequired: true },
    })
  }

  if (new Date(quote.expires_at).getTime() < Date.now()) {
    await supabase
      .from('bulk_device_imports')
      .update({ status: 'expired', error_message: 'Quote expired' })
      .eq('id', importId)
      .eq('status', 'quoted')

    throw createError({
      statusCode: 409,
      message: 'Quote expired. Generate a new cost confirmation.',
      data: { refreshRequired: true },
    })
  }

  const { data: claimed, error: claimError } = await supabase
    .from('bulk_device_imports')
    .update({
      status: 'processing',
      claimed_at: new Date().toISOString(),
    })
    .eq('id', importId)
    .eq('status', 'quoted')
    .select('*')
    .maybeSingle()

  if (claimError) {
    throw createError({ statusCode: 500, message: claimError.message })
  }
  if (!claimed) {
    throw createError({
      statusCode: 409,
      message: 'This import was already claimed. Refresh and try again if devices were not created.',
      data: { refreshRequired: true },
    })
  }

  const devices = (claimed.devices || []) as BulkDeviceInput[]

  try {
    const conflicts = await findConflictingMacs(supabase, orgId, devices)
    if (conflicts.length) {
      throw createError({
        statusCode: 409,
        message: `MAC already exists in this organization: ${conflicts.slice(0, 5).join(', ')}`,
        data: { conflictingMacs: conflicts, refreshRequired: true },
      })
    }

    const plan = await resolveCapacityPlan(supabase, orgId, devices.length)

    if (
      plan.currentCount !== claimed.current_device_count ||
      plan.targetQuantity !== claimed.target_stripe_quantity
    ) {
      throw createError({
        statusCode: 409,
        message:
          'Fleet size or billing changed since this quote. Generate a new cost confirmation.',
        data: { refreshRequired: true },
      })
    }

    let stripeRaised = false
    if (plan.needsStripeUpdate) {
      await applyStripeQuantity(
        plan.org,
        plan.targetQuantity,
        claimed.stripe_idempotency_key,
      )
      stripeRaised = true
      await persistStripeQuantity(supabase, orgId, plan.targetQuantity)
    }

    const enriched = devices.map((d) => ({
      name: d.name,
      mac_address: d.mac_address,
      tags: d.tags || {},
      api_key: randomApiKey(),
    }))

    const { data: inserted, error: rpcError } = await supabase.rpc('bulk_insert_devices', {
      p_org_id: orgId,
      p_user_id: claimed.user_id,
      p_devices: enriched,
      p_expected_current_count: plan.currentCount,
    })

    if (rpcError) {
      if (stripeRaised) {
        try {
          await restoreStripeQuantity(
            { ...plan.org, stripe_quantity: plan.targetQuantity },
            plan.previousQuantity,
            claimed.stripe_idempotency_key,
          )
          await persistStripeQuantity(supabase, orgId, plan.previousQuantity)
        } catch (restoreErr: any) {
          console.error('Failed to restore Stripe quantity after bulk insert failure', restoreErr)
        }
      }

      const message = rpcError.message || 'Bulk insert failed'
      if (message.includes('DEVICE_COUNT_CHANGED') || message.includes('MAC_CONFLICT')) {
        throw createError({
          statusCode: 409,
          message:
            'Fleet changed during import (count or MAC conflict). Generate a new cost confirmation.',
          data: { refreshRequired: true },
        })
      }
      throw createError({ statusCode: 500, message })
    }

    const created = (inserted || []) as Array<Record<string, unknown>>
    const createdIds = created.map((d) => String(d.id))

    await supabase
      .from('bulk_device_imports')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        created_device_ids: createdIds,
        error_message: null,
      })
      .eq('id', importId)

    return {
      importId,
      devices: created,
      alreadyCompleted: false,
      quantityDelta: plan.quantityDelta,
      projectedDeviceCount: plan.projectedCount,
    }
  } catch (err: any) {
    const statusCode = err?.statusCode
    const message = err?.message || 'Bulk import failed'

    await supabase
      .from('bulk_device_imports')
      .update({
        status: statusCode === 409 ? 'failed' : 'failed',
        error_message: message,
      })
      .eq('id', importId)
      .eq('status', 'processing')

    if (statusCode) throw err
    throw createError({ statusCode: 500, message })
  }
})

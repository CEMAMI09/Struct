import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../../utils/auth'
import { formatMoney, QUOTE_TTL_MS } from '../../../utils/bulkDevices'
import { estimateProrationCents, resolveCapacityPlan } from '../../../utils/deviceCapacity'
import {
  normalizeHardwareId,
  PROFILE_BULK_MAX_ROWS,
  type ProfileBulkDeviceInput,
} from '#shared/profileBulkUpload'

function normalizeDevices(raw: unknown): ProfileBulkDeviceInput[] {
  if (!Array.isArray(raw) || !raw.length) {
    throw createError({ statusCode: 400, message: 'devices array is required' })
  }
  if (raw.length > PROFILE_BULK_MAX_ROWS) {
    throw createError({
      statusCode: 400,
      message: `Batch limit is ${PROFILE_BULK_MAX_ROWS} devices`,
    })
  }

  const seen = new Set<string>()
  const devices: ProfileBulkDeviceInput[] = []

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as any
    const hardware_id = normalizeHardwareId(row?.hardware_id ?? row?.serial)
    const name = typeof row?.name === 'string' ? row.name.trim() : ''
    if (!hardware_id) {
      throw createError({
        statusCode: 400,
        message: `Row ${i + 1}: invalid hardware_id / serial`,
      })
    }
    if (seen.has(hardware_id)) {
      throw createError({
        statusCode: 400,
        message: `Duplicate hardware_id in payload: ${hardware_id}`,
      })
    }
    seen.add(hardware_id)

    let mac_address: string | null = null
    if (row?.mac_address) {
      const hex = String(row.mac_address).toLowerCase().replace(/[^0-9a-f]/g, '')
      if (hex.length !== 12) {
        throw createError({
          statusCode: 400,
          message: `Row ${i + 1}: invalid mac_address`,
        })
      }
      mac_address = hex
    }

    const tags =
      row?.tags && typeof row.tags === 'object' && !Array.isArray(row.tags)
        ? Object.fromEntries(
            Object.entries(row.tags)
              .filter(([k, v]) => typeof k === 'string' && typeof v === 'string')
              .map(([k, v]) => [k.trim(), String(v).trim()])
              .filter(([k]) => k),
          )
        : {}

    devices.push({
      name: name || `Unit-${hardware_id}`,
      hardware_id,
      mac_address,
      tags,
    })
  }

  return devices
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    orgId?: string
    profileId?: string
    devices?: unknown
  }>(event)

  const orgId = body?.orgId?.trim()
  const profileId = body?.profileId?.trim()
  if (!orgId || !profileId) {
    throw createError({ statusCode: 400, message: 'orgId and profileId are required' })
  }

  const { user } = await requireOrgWriter(event, orgId)
  const devices = normalizeDevices(body?.devices)
  const supabase = await serverSupabaseServiceRole(event)

  const { data: profile, error: profileError } = await supabase
    .from('device_profiles')
    .select('id, organization_id, name')
    .eq('id', profileId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (profileError) {
    throw createError({ statusCode: 500, message: profileError.message })
  }
  if (!profile) {
    throw createError({ statusCode: 404, message: 'Device profile not found' })
  }

  const hardwareIds = devices.map((d) => d.hardware_id)
  const { data: existing, error: existingError } = await supabase
    .from('devices')
    .select('hardware_id')
    .eq('organization_id', orgId)
    .eq('profile_id', profileId)
    .in('hardware_id', hardwareIds)

  if (existingError) {
    throw createError({ statusCode: 500, message: existingError.message })
  }
  if (existing?.length) {
    const conflicts = existing.map((r) => r.hardware_id).slice(0, 5)
    throw createError({
      statusCode: 409,
      message: `Serial already provisioned under this profile: ${conflicts.join(', ')}`,
      data: { conflictingHardwareIds: existing.map((r) => r.hardware_id) },
    })
  }

  const plan = await resolveCapacityPlan(supabase, orgId, devices.length)
  const estimate = plan.needsUsageUpdate
    ? await estimateProrationCents(plan.org, plan.projectedPeakPaidQuantity)
    : { amount: plan.estimatedTrueUpCents, currency: 'usd' }

  const payloadHash = createHash('sha256')
    .update(
      JSON.stringify({
        profileId,
        devices: devices
          .map((d) => ({
            hardware_id: d.hardware_id,
            name: d.name,
            mac_address: d.mac_address || null,
            tags: d.tags,
          }))
          .sort((a, b) => a.hardware_id.localeCompare(b.hardware_id)),
      }),
    )
    .digest('hex')

  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString()

  const { data: quote, error } = await supabase
    .from('bulk_device_imports')
    .insert({
      organization_id: orgId,
      user_id: user.id,
      payload_hash: `profile:${profileId}:${payloadHash}`,
      devices: devices.map((d) => ({ ...d, profile_id: profileId })),
      status: 'quoted',
      current_device_count: plan.currentCount,
      projected_device_count: plan.projectedCount,
      previous_stripe_quantity: plan.currentPeakDeviceCount,
      target_stripe_quantity: plan.projectedPeakPaidQuantity,
      estimated_proration_amount: estimate.amount,
      currency: estimate.currency,
      stripe_idempotency_key: `profile-provision:${orgId}:${profileId}:${payloadHash}`,
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
    profileId,
    expiresAt: quote.expires_at,
    deviceCount: devices.length,
    currentDeviceCount: quote.current_device_count,
    projectedDeviceCount: quote.projected_device_count,
    previousPeakPaidQuantity: quote.previous_stripe_quantity,
    projectedPeakPaidQuantity: quote.target_stripe_quantity,
    quantityDelta: quote.target_stripe_quantity - quote.previous_stripe_quantity,
    estimatedTrueUpAmount: quote.estimated_proration_amount ?? 0,
    currency: quote.currency || 'usd',
    estimatedTrueUpFormatted: formatMoney(
      quote.estimated_proration_amount ?? 0,
      quote.currency || 'usd',
    ),
    needsUsageUpdate: plan.needsUsageUpdate,
    disclaimer:
      'Estimated month-end overage from your billing period high-water mark. Billed once at period close, not per device add/delete.',
  }
})

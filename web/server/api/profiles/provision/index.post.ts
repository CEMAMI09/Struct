import { serverSupabaseServiceRole } from '#supabase/server'
import { requireOrgWriter } from '../../../utils/auth'
import type { BulkImportRow } from '../../../utils/bulkDevices'
import { createDeviceCredentials, recoverDeviceCredentials, sanitizeDeviceForClient } from '../../../utils/deviceCredentials'
import { resolveCapacityPlan } from '../../../utils/deviceCapacity'
import type { ProfileBulkDeviceInput } from '#shared/profileBulkUpload'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    orgId?: string
    profileId?: string
    importId?: string
  }>(event)

  const orgId = body?.orgId?.trim()
  const profileId = body?.profileId?.trim()
  const importId = body?.importId?.trim()

  if (!orgId || !profileId || !importId) {
    throw createError({
      statusCode: 400,
      message: 'orgId, profileId, and importId are required',
    })
  }

  const { user } = await requireOrgWriter(event, orgId)
  const supabase = await serverSupabaseServiceRole(event)

  const { data: profile, error: profileError } = await supabase
    .from('device_profiles')
    .select('id')
    .eq('id', profileId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (profileError) {
    throw createError({ statusCode: 500, message: profileError.message })
  }
  if (!profile) {
    throw createError({ statusCode: 404, message: 'Device profile not found' })
  }

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
    throw createError({ statusCode: 404, message: 'Provisioning quote not found' })
  }

  const quote = existing as unknown as BulkImportRow

  if (quote.status === 'completed') {
    const { data: devices, error: devicesError } = await supabase
      .from('devices')
      .select('*')
      .in('id', quote.created_device_ids || [])

    if (devicesError) {
      throw createError({ statusCode: 500, message: devicesError.message })
    }

    const canRecover = quote.user_id === user.id && new Date(quote.expires_at).getTime() > Date.now()
    const credentials = canRecover ? recoverDeviceCredentials(devices || []) : []
    return {
      importId: quote.id,
      devices: (devices || []).map(sanitizeDeviceForClient),
      credentials,
      credentialsRecovered: credentials.length > 0,
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

  const quotedDevices = (quote.devices || []) as unknown as Array<ProfileBulkDeviceInput & { profile_id?: string }>
  if (quotedDevices.some((d) => d.profile_id && d.profile_id !== profileId)) {
    throw createError({
      statusCode: 400,
      message: 'Quote profile does not match request profileId',
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

  try {
    const plan = await resolveCapacityPlan(supabase, orgId, quotedDevices.length)

    if (
      plan.currentCount !== claimed.current_device_count ||
      plan.projectedPeakPaidQuantity !== claimed.target_stripe_quantity
    ) {
      throw createError({
        statusCode: 409,
        message:
          'Fleet size or billing changed since this quote. Generate a new cost confirmation.',
        data: { refreshRequired: true },
      })
    }

    const generated = quotedDevices.map((device) => ({ device, creds: createDeviceCredentials() }))
    const enriched = generated.map(({ device: d, creds }) => ({
      name: d.name,
      hardware_id: d.hardware_id,
      mac_address: d.mac_address || null,
      tags: d.tags || {},
      key_id: creds.keyId,
      api_secret_encrypted: creds.apiSecretEncrypted,
      api_secret_preview: creds.apiSecretPreview,
    }))

    const { data: inserted, error: rpcError } = await supabase.rpc(
      'bulk_provision_profile_devices',
      {
        p_org_id: orgId,
        p_user_id: claimed.user_id,
        p_profile_id: profileId,
        p_devices: enriched,
        p_expected_current_count: plan.currentCount,
      },
    )

    if (rpcError) {
      const message = rpcError.message || 'Bulk provision failed'
      if (
        message.includes('DEVICE_COUNT_CHANGED') ||
        message.includes('HARDWARE_ID_CONFLICT') ||
        message.includes('PROFILE_NOT_FOUND')
      ) {
        throw createError({
          statusCode: 409,
          message:
            'Fleet or profile changed during import. Generate a new cost confirmation.',
          data: { refreshRequired: true },
        })
      }
      throw createError({ statusCode: 500, message })
    }

    const created = (inserted || []) as Array<Record<string, unknown>>
    const createdIds = created.map((d) => String(d.id))
    const createdIdByKey = new Map(created.map((d) => [String(d.key_id), String(d.id)]))
    const credentials = generated.map(({ device, creds }) => ({
      deviceId: createdIdByKey.get(creds.keyId) || '',
      name: device.name,
      keyId: creds.keyId,
      apiSecret: creds.apiSecret,
    }))

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
      devices: created.map(sanitizeDeviceForClient),
      credentials,
      alreadyCompleted: false,
      peakPaidDelta: plan.overageDelta,
      projectedDeviceCount: plan.projectedCount,
    }
  } catch (err: any) {
    const statusCode = err?.statusCode
    const message = err?.message || 'Bulk provision failed'

    await supabase
      .from('bulk_device_imports')
      .update({
        status: 'failed',
        error_message: message,
      })
      .eq('id', importId)
      .eq('status', 'processing')

    if (statusCode) throw err
    throw createError({ statusCode: 500, message })
  }
})

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  hashBulkDevices,
  sha256Hex,
  validateBulkDevices,
  type BulkDeviceInput,
  type BulkRowError,
} from '#shared/bulkUpload'

export type { BulkDeviceInput, BulkRowError }

export interface BulkImportRow {
  id: string
  organization_id: string
  user_id: string
  payload_hash: string
  devices: BulkDeviceInput[]
  status: 'quoted' | 'processing' | 'completed' | 'failed' | 'expired'
  current_device_count: number
  projected_device_count: number
  previous_stripe_quantity: number
  target_stripe_quantity: number
  estimated_proration_amount: number | null
  currency: string | null
  stripe_idempotency_key: string
  error_message: string | null
  created_device_ids: string[]
  quoted_at: string
  expires_at: string
  claimed_at: string | null
  completed_at: string | null
}

export function randomApiKey() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let key = ''
  for (let i = 0; i < 16; i++) {
    key += alphabet[bytes[i]! % alphabet.length]
  }
  return key
}

export async function normalizeAndValidateBulkPayload(rawDevices: unknown) {
  if (!Array.isArray(rawDevices)) {
    throw createError({ statusCode: 400, message: 'devices must be an array' })
  }

  const asInputs: BulkDeviceInput[] = rawDevices.map((row) => {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    return {
      name: typeof r.name === 'string' ? r.name : '',
      mac_address: typeof r.mac_address === 'string' ? r.mac_address : '',
      tags:
        r.tags && typeof r.tags === 'object' && !Array.isArray(r.tags)
          ? (r.tags as Record<string, string>)
          : {},
    }
  })

  const { valid, errors } = validateBulkDevices(asInputs)
  if (errors.length || !valid.length) {
    throw createError({
      statusCode: 400,
      message: 'Invalid bulk device payload',
      data: { errors },
    })
  }

  const payloadHash = await sha256Hex(hashBulkDevices(valid))
  return { devices: valid, payloadHash, errors }
}

export async function findConflictingMacs(
  supabase: SupabaseClient,
  orgId: string,
  devices: BulkDeviceInput[],
) {
  const macs = devices.map((d) => d.mac_address)
  const { data, error } = await supabase
    .from('devices')
    .select('mac_address')
    .eq('organization_id', orgId)
    .in('mac_address', macs)

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }

  return (data || [])
    .map((row) => row.mac_address as string | null)
    .filter((mac): mac is string => !!mac)
}

export function formatMoney(amountCents: number, currency: string) {
  const amount = amountCents / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount)
  } catch {
    return `$${(amount).toFixed(2)}`.replace('$$', `${currency.toUpperCase()} `)
  }
}

export const QUOTE_TTL_MS = 15 * 60 * 1000

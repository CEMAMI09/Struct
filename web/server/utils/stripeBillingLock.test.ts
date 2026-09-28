import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isDefinitiveStripeFailure, withOrgBillingLock } from './stripeBillingLock'

beforeEach(() => vi.stubGlobal('createError', ({ message }: { message: string }) => new Error(message)))

function fakeDb() {
  let held: string | null = null
  const rpc = vi.fn(async (name: string, args: { p_claim_token: string }) => {
    if (name === 'claim_org_billing_operation') {
      if (held) return { data: false, error: null }
      held = args.p_claim_token
      return { data: true, error: null }
    }
    if (held === args.p_claim_token) held = null
    return { data: true, error: null }
  })
  return { db: { rpc } as unknown as SupabaseClient, rpc }
}

describe('organization billing guard', () => {
  it('prevents an overlapping webhook snapshot while an upgrade is committing', async () => {
    const { db } = fakeDb()
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const first = withOrgBillingLock(db, 'org', async () => pending)
    await Promise.resolve()
    const staleWrite = vi.fn()
    await expect(withOrgBillingLock(db, 'org', staleWrite)).rejects.toThrow('being synchronized')
    expect(staleWrite).not.toHaveBeenCalled()
    finish()
    await first
    await expect(withOrgBillingLock(db, 'org', async () => 'latest')).resolves.toBe('latest')
  })

  it('retains an ambiguous mutation so another request cannot charge again', async () => {
    const { db } = fakeDb()
    await expect(withOrgBillingLock(db, 'org', async guard => {
      guard.retain()
      throw new Error('network timeout after Stripe accepted request')
    })).rejects.toThrow('network timeout')
    await expect(withOrgBillingLock(db, 'org', async () => 'unsafe')).rejects.toThrow('being synchronized')
  })

  it('distinguishes definitive Stripe rejection from unknown outcome', () => {
    expect(isDefinitiveStripeFailure({ type: 'StripeCardError' })).toBe(true)
    expect(isDefinitiveStripeFailure({ type: 'StripeInvalidRequestError' })).toBe(true)
    expect(isDefinitiveStripeFailure({ type: 'StripeAPIError' })).toBe(false)
    expect(isDefinitiveStripeFailure({ type: 'StripeConnectionError' })).toBe(false)
    expect(isDefinitiveStripeFailure({ type: 'StripeIdempotencyError' })).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useStripeClient } from './stripe'

beforeEach(() => {
  vi.stubGlobal('createError', (options: { statusCode: number; message: string }) =>
    Object.assign(new Error(options.message), { statusCode: options.statusCode }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function configure(key: string, environment?: string) {
  vi.stubEnv('VERCEL_ENV', environment)
  vi.stubGlobal('useRuntimeConfig', () => ({ stripeSecretKey: key }))
}

describe('Stripe deployment mode', () => {
  it.each(['sk_test_fixture', 'rk_test_fixture'])('rejects %s in production without exposing the key', (key) => {
    configure(key, 'production')
    expect(useStripeClient).toThrow('live STRIPE_SECRET_KEY is required')
    try {
      useStripeClient()
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 500 })
      expect((error as Error).message).not.toContain(key)
    }
  })

  it.each(['sk_live_fixture', 'rk_live_fixture'])('creates a production client with %s', (key) => {
    configure(key, 'production')
    expect(useStripeClient()).toBeInstanceOf(Stripe)
  })

  it('allows a test key in a preview deployment', () => {
    configure('sk_test_fixture', 'preview')
    expect(useStripeClient()).toBeInstanceOf(Stripe)
  })

  it('allows a test key locally', () => {
    configure('rk_test_fixture')
    expect(useStripeClient()).toBeInstanceOf(Stripe)
  })

  it('retains the missing-key configuration error', () => {
    configure('', 'production')
    expect(useStripeClient).toThrow('missing STRIPE_SECRET_KEY')
  })
})

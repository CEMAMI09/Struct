import Stripe from 'stripe'

export function useStripeClient() {
  const config = useRuntimeConfig()
  if (!config.stripeSecretKey) {
    throw createError({
      statusCode: 500,
      message: 'Stripe is not configured (missing STRIPE_SECRET_KEY)',
    })
  }

  if (process.env.VERCEL_ENV === 'production' && /^(sk|rk)_test_/.test(config.stripeSecretKey)) {
    throw createError({
      statusCode: 500,
      message: 'Stripe is not configured for production (live STRIPE_SECRET_KEY is required)',
    })
  }

  return new Stripe(config.stripeSecretKey)
}

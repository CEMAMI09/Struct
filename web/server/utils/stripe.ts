import Stripe from 'stripe'

export function useStripeClient() {
  const config = useRuntimeConfig()
  if (!config.stripeSecretKey) {
    throw createError({
      statusCode: 500,
      message: 'Stripe is not configured (missing STRIPE_SECRET_KEY)',
    })
  }

  return new Stripe(config.stripeSecretKey)
}

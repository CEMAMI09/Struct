import type Stripe from 'stripe'
import type { PaidTier } from './billing'

const EXPECTED: Record<PaidTier, { floor: number; baseCents: number; extraCents: number }> = {
  flexible: { floor: 5, baseCents: 500, extraCents: 100 },
  pro: { floor: 150, baseCents: 4900, extraCents: 50 },
  scale: { floor: 1000, baseCents: 24900, extraCents: 20 },
}

/** Prevent a stale or misconfigured Stripe price from charging customers more
 * than the amount quoted by Struct. Stripe prices are immutable, so compare
 * the actual price before creating Checkout or changing a subscription. */
export async function assertStripePriceMatchesPlan(
  stripe: Stripe,
  tier: PaidTier,
  priceId: string,
) {
  const price = await stripe.prices.retrieve(priceId, { expand: ['tiers'] })
  const expected = EXPECTED[tier]
  const tiers = price.tiers || []
  const [base, extra] = tiers
  const matches = price.active && price.type === 'recurring' &&
    price.currency === 'usd' && price.billing_scheme === 'tiered' &&
    price.tiers_mode === 'graduated' && price.recurring?.interval === 'month' &&
    price.recurring.interval_count === 1 && price.recurring.usage_type === 'licensed' &&
    tiers.length === 2 && base?.up_to === expected.floor &&
    base.flat_amount === expected.baseCents && (base.unit_amount ?? 0) === 0 &&
    extra?.up_to === null && (extra.flat_amount ?? 0) === 0 &&
    extra.unit_amount === expected.extraCents

  if (!matches) {
    console.error('[stripe] configured price does not match Struct plan', { tier, priceId })
    throw createError({
      statusCode: 503,
      message: 'Billing for this plan is temporarily unavailable. Contact support.',
    })
  }
}

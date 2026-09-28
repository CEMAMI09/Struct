import type Stripe from 'stripe'
import type { PaidTier } from './billing'

const EXPECTED: Record<PaidTier, { floor: number; baseCents: number; extraCents: number }> = {
  flexible: { floor: 5, baseCents: 500, extraCents: 100 },
  pro: { floor: 150, baseCents: 4900, extraCents: 50 },
  scale: { floor: 1000, baseCents: 24900, extraCents: 20 },
}

// Temporary transition for the one archived live Pro price that charged $50
// per extra device instead of $0.50. Remove after every deployment environment
// uses the corrected price. These are public Stripe object IDs, not secrets.
const ARCHIVED_LIVE_PRO_PRICE = 'price_1TtJ9NRu9PxBJUvyU8TsUSvX'
const CORRECTED_LIVE_PRO_PRICE = 'price_1UKPCFRu9PxBJUvyd5HMupyP'

/** Recognize legacy subscriptions without ever creating a new one on that price. */
export function tierForStripePrice(
  priceId: string | undefined,
  prices: { flexible: string; pro: string; scale: string },
): PaidTier | null {
  if (!priceId) return null
  if (priceId === prices.flexible) return 'flexible'
  if (priceId === prices.pro ||
    (prices.pro === CORRECTED_LIVE_PRO_PRICE && priceId === ARCHIVED_LIVE_PRO_PRICE)) return 'pro'
  if (priceId === prices.scale) return 'scale'
  return null
}

export function resolveStripePriceIds(config: {
  stripePriceFlexible: string
  stripePricePro: string
  stripePriceScale: string
}) {
  return {
    flexible: config.stripePriceFlexible,
    pro: config.stripePricePro === ARCHIVED_LIVE_PRO_PRICE
      ? CORRECTED_LIVE_PRO_PRICE : config.stripePricePro,
    scale: config.stripePriceScale,
  }
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

export type SubscriptionTier = 'free' | 'flexible' | 'pro' | 'scale'
export type PaidTier = Exclude<SubscriptionTier, 'free'>

export const FREE_DEVICE_POOL = 5

/** Minimum billed quantity per paid tier (on top of the 5 free devices). */
export const TIER_FLOORS: Record<SubscriptionTier, number> = {
  free: 0,
  flexible: 5,
  pro: 150,
  scale: 1000,
}

/** Starting Stripe line-item quantity at checkout (same as tier floor). */
export const TIER_CHECKOUT_QUANTITY: Record<PaidTier, number> = {
  flexible: 5,
  pro: 150,
  scale: 1000,
}

export interface OrganizationBillingRow {
  id: string
  subscription_tier: SubscriptionTier
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_item_id: string | null
  stripe_quantity: number
}

export function isPaidTier(tier: SubscriptionTier): tier is PaidTier {
  return tier !== 'free'
}

export function getDeviceLimit(quantity: number) {
  return FREE_DEVICE_POOL + quantity
}

export function getRequiredQuantity(
  tier: SubscriptionTier,
  remainingDevices: number,
) {
  const floor = TIER_FLOORS[tier]
  return Math.max(floor, remainingDevices - FREE_DEVICE_POOL)
}

export function getPriceIdForTier(
  tier: PaidTier,
  prices: { flexible: string; pro: string; scale: string },
) {
  if (tier === 'flexible') return prices.flexible
  if (tier === 'pro') return prices.pro
  return prices.scale
}

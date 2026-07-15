import type { SubscriptionTier } from '~/types'

export type Entitlement =
  | 'basic_webhooks'
  | 'live_debugger'
  | 'chacha20'
  | 'downlinks'
  | 'telemetry_30d'
  | 'team_rbac'
  | 'audit_logs'
  | 'logical_routing'

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  flexible: 1,
  pro: 2,
  scale: 3,
}

const REQUIRED_TIER: Record<Entitlement, SubscriptionTier> = {
  basic_webhooks: 'free',
  live_debugger: 'free',
  chacha20: 'pro',
  downlinks: 'pro',
  telemetry_30d: 'pro',
  team_rbac: 'scale',
  audit_logs: 'scale',
  logical_routing: 'scale',
}

const RETENTION_DAYS: Record<SubscriptionTier, number> = {
  free: 1,
  flexible: 7,
  pro: 30,
  scale: 30,
}

export function useEntitlements() {
  const { currentOrganization } = useOrganization()
  const tier = computed<SubscriptionTier>(
    () => currentOrganization.value?.subscription_tier || 'free',
  )

  function hasEntitlement(entitlement: Entitlement) {
    return TIER_RANK[tier.value] >= TIER_RANK[REQUIRED_TIER[entitlement]]
  }

  function requiredTier(entitlement: Entitlement) {
    return REQUIRED_TIER[entitlement]
  }

  const telemetryRetentionDays = computed(() => RETENTION_DAYS[tier.value])

  return {
    tier,
    hasEntitlement,
    requiredTier,
    telemetryRetentionDays,
  }
}

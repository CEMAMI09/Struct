import type { SubscriptionTier } from '~/types'

type PaidTier = Exclude<SubscriptionTier, 'free'>

export function useBilling() {
  const { currentOrgId, requireWrite, fetchMemberships } = useOrganization()
  const loading = useState('billing-loading', () => false)
  const error = useState<string | null>('billing-error', () => null)

  async function startCheckout(targetTier: PaidTier) {
    requireWrite()
    const orgId = currentOrgId.value
    if (!orgId) throw new Error('No organization selected')

    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{
        url?: string
        upgraded?: boolean
        subscriptionTier?: SubscriptionTier
        stripeQuantity?: number
      }>('/api/stripe/checkout', {
        method: 'POST',
        body: { orgId, targetTier },
      })

      if (result.upgraded) {
        await fetchMemberships()
        return result
      }

      if (import.meta.client && result.url) {
        window.location.href = result.url
      }
      return result
    } catch (e: any) {
      error.value = e?.data?.message || e.message || 'Failed to start checkout'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function openPortal() {
    requireWrite()
    const orgId = currentOrgId.value
    if (!orgId) throw new Error('No organization selected')

    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ url: string }>('/api/stripe/portal', {
        method: 'POST',
        body: { orgId },
      })
      if (import.meta.client && result.url) {
        window.location.href = result.url
      }
      return result
    } catch (e: any) {
      error.value = e?.data?.message || e.message || 'Failed to open billing portal'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function syncCheckout(sessionId: string) {
    requireWrite()
    loading.value = true
    error.value = null
    try {
      return await $fetch<{
        ok: boolean
        subscriptionTier: SubscriptionTier
        stripeQuantity: number
      }>('/api/stripe/sync-checkout', {
        method: 'POST',
        body: { sessionId },
      })
    } catch (e: any) {
      error.value = e?.data?.message || e.message || 'Failed to sync subscription'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function syncFromStripe() {
    const orgId = currentOrgId.value
    if (!orgId) return null

    try {
      const result = await $fetch<{
        ok: boolean
        synced: boolean
        subscriptionTier: SubscriptionTier
        stripeQuantity: number
        deviceLimit: number
      }>('/api/stripe/sync', {
        method: 'POST',
        body: { orgId },
      })
      await fetchMemberships()
      const { fetchUsageStats } = useOrganization()
      await fetchUsageStats()
      return result
    } catch (e: any) {
      // Non-fatal on page load — keep showing last known org state.
      console.warn('[billing] stripe sync failed', e?.data?.message || e?.message || e)
      return null
    }
  }

  return {
    loading,
    error,
    startCheckout,
    openPortal,
    syncCheckout,
    syncFromStripe,
  }
}

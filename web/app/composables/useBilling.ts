import type { SubscriptionTier } from '~/types'

type PaidTier = Exclude<SubscriptionTier, 'free'>

export function useBilling() {
  const { currentOrgId, requireWrite } = useOrganization()
  const loading = useState('billing-loading', () => false)
  const error = useState<string | null>('billing-error', () => null)

  async function startCheckout(targetTier: PaidTier) {
    requireWrite()
    const orgId = currentOrgId.value
    if (!orgId) throw new Error('No organization selected')

    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ url: string }>('/api/stripe/checkout', {
        method: 'POST',
        body: { orgId, targetTier },
      })
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

  return {
    loading,
    error,
    startCheckout,
    openPortal,
    syncCheckout,
  }
}

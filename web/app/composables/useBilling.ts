import type { SubscriptionTier } from '~/types'

type PaidTier = Exclude<SubscriptionTier, 'free'>

const syncControls=new WeakMap<object,{pending:Promise<any>|null;org:string|null}>()
export function useBilling() {
  const app=useNuxtApp();if(!syncControls.has(app))syncControls.set(app,{pending:null,org:null});const control=syncControls.get(app)!
  const syncing=useState('billing-syncing',()=>false)
  const { currentOrgId, requireWrite, fetchMemberships,fetchUsageStats } = useOrganization()
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
    const orgId=currentOrgId.value;if(!orgId)return null
    if(control.pending&&control.org===orgId)return control.pending
    control.org=orgId;syncing.value=true;error.value=null
    const run=(async()=>{
      try {
        const result=await $fetch<{ok:boolean;synced:boolean;subscriptionTier:SubscriptionTier;stripeQuantity:number;deviceLimit:number}>('/api/stripe/sync',{method:'POST',body:{orgId}})
        if(currentOrgId.value!==orgId)return null
        await fetchMemberships()
        await fetchUsageStats({force:true})
        return currentOrgId.value===orgId?result:null
      }catch(e:any){if(currentOrgId.value===orgId)error.value='Unable to refresh billing information. Please try again.';return null}
    })().finally(()=>{if(control.pending===run){control.pending=null;syncing.value=false}})
    control.pending=run;return run
  }

  return {
    loading,
    syncing,
    error,
    startCheckout,
    openPortal,
    syncCheckout,
    syncFromStripe,
  }
}

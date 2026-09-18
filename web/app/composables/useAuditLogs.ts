import type { AuditLog } from '~/types'

const auditInflightByApp = new WeakMap<object, { promise: Promise<void> | null }>()

export function useAuditLogs() {
  const app = useNuxtApp()
  if (!auditInflightByApp.has(app)) auditInflightByApp.set(app, { promise: null })
  const inflight = auditInflightByApp.get(app)!
  const supabase = useSupabaseClient()
  const { currentOrgId, ensureOrganization, isEnterprise } = useOrganization()

  const auditLogs = useState<AuditLog[]>('audit-logs', () => [])
  const loading = useState('audit-logs-loading', () => false)
  const error = useState<string | null>('audit-logs-error', () => null)
  const loadedForOrg = useState<string | null>('audit-logs-loaded-org', () => null)

  async function fetchAuditLogs(opts?: { force?: boolean }) {
    if (inflight.promise && !opts?.force) {
      return inflight.promise
    }

    const run = async () => {
      const cacheHit = !!loadedForOrg.value && loadedForOrg.value === currentOrgId.value
      if (!cacheHit) loading.value = true
      error.value = null

      try {
        await ensureOrganization()
        if (!isEnterprise.value) {
          auditLogs.value = []
          loadedForOrg.value = currentOrgId.value
          return
        }

        const organizationId = currentOrgId.value
        if (!organizationId) {
          auditLogs.value = []
          loadedForOrg.value = null
          return
        }

        const { data, error: queryError } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(200)

        if (queryError) throw queryError
        auditLogs.value = (data || []) as AuditLog[]
        loadedForOrg.value = organizationId
      } catch (e: any) {
        error.value = e.message || 'Failed to load audit logs'
      } finally {
        loading.value = false
      }
    }

    const promise = run().finally(() => {
      if (inflight.promise === promise) inflight.promise = null
    })
    inflight.promise = promise
    return inflight.promise
  }

  return {
    auditLogs,
    loading,
    error,
    fetchAuditLogs,
  }
}

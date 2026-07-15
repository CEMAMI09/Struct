import type { AuditLog } from '~/types'

export function useAuditLogs() {
  const supabase = useSupabaseClient()
  const { currentOrgId, ensureOrganization, isEnterprise } = useOrganization()

  const auditLogs = useState<AuditLog[]>('audit-logs', () => [])
  const loading = useState('audit-logs-loading', () => false)
  const error = useState<string | null>('audit-logs-error', () => null)

  async function fetchAuditLogs() {
    loading.value = true
    error.value = null

    try {
      await ensureOrganization()
      if (!isEnterprise.value) {
        auditLogs.value = []
        return
      }

      const organizationId = currentOrgId.value
      if (!organizationId) {
        auditLogs.value = []
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
    } catch (e: any) {
      error.value = e.message || 'Failed to load audit logs'
    } finally {
      loading.value = false
    }
  }

  return {
    auditLogs,
    loading,
    error,
    fetchAuditLogs,
  }
}

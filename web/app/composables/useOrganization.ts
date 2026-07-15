import type { OrgRole, Organization, OrganizationMember } from '~/types'

export interface OrgMembership extends OrganizationMember {
  organization: Organization
}

export interface OrgMemberRow {
  id: string
  user_id: string
  email: string
  role: OrgRole
  created_at: string
}

const STORAGE_KEY = 'struct.currentOrgId'

export function useOrganization() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const memberships = useState<OrgMembership[]>('org-memberships', () => [])
  const currentOrgId = useState<string | null>('current-org-id', () => null)
  const loading = useState('org-loading', () => false)
  const ready = useState('org-ready', () => false)
  const error = useState<string | null>('org-error', () => null)

  const currentMembership = computed(
    () => memberships.value.find((m) => m.organization_id === currentOrgId.value) || null,
  )
  const currentOrganization = computed(() => currentMembership.value?.organization || null)
  const role = computed<OrgRole | null>(() => currentMembership.value?.role ?? null)
  const canWrite = computed(() => role.value === 'owner' || role.value === 'admin')
  const isViewer = computed(() => role.value === 'viewer')
  const isOwner = computed(() => role.value === 'owner')
  const isEnterprise = computed(
    () => currentOrganization.value?.subscription_tier === 'scale',
  )
  const deviceLimit = computed(
    () => 5 + (currentOrganization.value?.stripe_quantity ?? 0),
  )

  function requireWrite() {
    if (!canWrite.value) {
      throw new Error('Viewers can only read — ask an org admin to make changes')
    }
  }

  function requireOrgId(): string {
    if (!currentOrgId.value) {
      throw new Error('No organization selected — refresh or sign in again')
    }
    return currentOrgId.value
  }

  function isEmptyFreePersonal(org: Organization) {
    return (
      org.name.trim().toLowerCase() === 'personal' &&
      org.subscription_tier === 'free' &&
      !org.stripe_customer_id &&
      !org.stripe_subscription_id
    )
  }

  function scoreOrganization(org: Organization) {
    let score = 0
    if (org.stripe_customer_id || org.stripe_subscription_id) score += 100
    if (org.subscription_tier !== 'free') score += 50
    score += org.stripe_quantity || 0
    if (!isEmptyFreePersonal(org)) score += 10
    return score
  }

  function pickDefaultOrgId(
    rows: OrgMembership[],
    preferred: string | null,
    current: string | null,
  ) {
    if (!rows.length) return null

    const preferredRow = preferred
      ? rows.find((m) => m.organization_id === preferred)
      : null
    if (preferredRow) {
      const better = rows
        .filter((m) => m.organization_id !== preferredRow.organization_id)
        .sort(
          (a, b) =>
            scoreOrganization(b.organization) - scoreOrganization(a.organization),
        )[0]
      // Recover from accidental empty Personal orgs created after a failed fetch.
      if (
        better &&
        isEmptyFreePersonal(preferredRow.organization) &&
        scoreOrganization(better.organization) > scoreOrganization(preferredRow.organization)
      ) {
        return better.organization_id
      }
      return preferredRow.organization_id
    }

    if (current && rows.some((m) => m.organization_id === current)) {
      const currentRow = rows.find((m) => m.organization_id === current)!
      const better = rows
        .filter((m) => m.organization_id !== current)
        .sort(
          (a, b) =>
            scoreOrganization(b.organization) - scoreOrganization(a.organization),
        )[0]
      if (
        better &&
        isEmptyFreePersonal(currentRow.organization) &&
        scoreOrganization(better.organization) > scoreOrganization(currentRow.organization)
      ) {
        return better.organization_id
      }
      return current
    }

    return [...rows].sort(
      (a, b) => scoreOrganization(b.organization) - scoreOrganization(a.organization),
    )[0]!.organization_id
  }

  async function fetchMemberships() {
    const { data: authData } = await supabase.auth.getUser()
    const uid = authData.user?.id || user.value?.id
    if (!uid) {
      memberships.value = []
      currentOrgId.value = null
      ready.value = false
      return
    }

    loading.value = true
    error.value = null
    try {
      // Only this user's memberships — RLS also returns teammates' rows for orgs you share.
      const { data, error: err } = await supabase
        .from('organization_members')
        .select('*, organization:organizations(*)')
        .eq('user_id', uid)
        .order('created_at', { ascending: true })

      if (err) throw err

      const rows = (data || []).map((row: any) => ({
        id: row.id,
        organization_id: row.organization_id,
        user_id: row.user_id,
        role: row.role as OrgRole,
        created_at: row.created_at,
        organization: row.organization as Organization,
      })) as OrgMembership[]

      memberships.value = rows.filter((m) => m.organization)

      let preferred: string | null = null
      if (import.meta.client) {
        preferred = localStorage.getItem(STORAGE_KEY)
      }

      currentOrgId.value = pickDefaultOrgId(
        memberships.value,
        preferred,
        currentOrgId.value,
      )

      if (currentOrgId.value && import.meta.client) {
        localStorage.setItem(STORAGE_KEY, currentOrgId.value)
      }
    } catch (e: any) {
      error.value = e.message || 'Failed to load organizations'
      // Keep any previously loaded memberships — never wipe on transient failures.
      // Clearing here caused ensureOrganization() to create a brand-new empty Personal org.
    } finally {
      loading.value = false
      ready.value = true
    }
  }

  /**
   * Ensure the user has at least one org (Personal) and a current selection.
   * Safe to call on every dashboard mount / after signup.
   */
  async function ensureOrganization() {
    await fetchMemberships()

    // Never invent a workspace when we failed to load the real ones.
    if (error.value) {
      throw new Error(error.value)
    }

    if (memberships.value.length > 0 && currentOrgId.value) {
      return currentOrganization.value
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
      throw new Error('Not authenticated — sign out and sign in again')
    }

    const { error: orgErr } = await supabase.rpc('create_organization', {
      p_name: 'Personal',
    })
    if (orgErr) throw orgErr

    await fetchMemberships()
    if (error.value) {
      throw new Error(error.value)
    }
    return currentOrganization.value
  }

  function clearOrganizationState() {
    memberships.value = []
    currentOrgId.value = null
    loading.value = false
    ready.value = false
    error.value = null
    if (import.meta.client) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function setCurrentOrg(orgId: string) {
    if (!memberships.value.some((m) => m.organization_id === orgId)) return
    currentOrgId.value = orgId
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, orgId)
    }
  }

  async function renameOrganization(name: string) {
    requireWrite()
    const orgId = requireOrgId()
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Organization name is required')

    const { data, error: err } = await supabase
      .from('organizations')
      .update({ name: trimmed })
      .eq('id', orgId)
      .select()
      .single()
    if (err) throw err

    memberships.value = memberships.value.map((m) =>
      m.organization_id === orgId
        ? { ...m, organization: { ...m.organization, name: data.name } }
        : m,
    )
    return data as Organization
  }

  async function listMembers(): Promise<OrgMemberRow[]> {
    const orgId = requireOrgId()
    const { data, error: err } = await supabase.rpc('list_org_members', {
      p_org_id: orgId,
    })
    if (err) throw err
    return (data || []) as OrgMemberRow[]
  }

  async function addMemberByEmail(email: string, memberRole: OrgRole = 'viewer') {
    requireWrite()
    const orgId = requireOrgId()
    const { error: err } = await supabase.rpc('add_org_member_by_email', {
      p_org_id: orgId,
      p_email: email.trim(),
      p_role: memberRole,
    })
    if (err) throw err
  }

  async function updateMemberRole(memberId: string, memberRole: OrgRole) {
    if (!isOwner.value) throw new Error('Only owners can change roles')
    const { error: err } = await supabase.rpc('update_org_member_role', {
      p_member_id: memberId,
      p_role: memberRole,
    })
    if (err) throw err
  }

  async function removeMember(memberId: string) {
    // Removing others is owner-only in the UI; RPC still enforces leave-self + last-owner rules.
    if (!isOwner.value) {
      throw new Error('Only owners can remove other members')
    }
    const { error: err } = await supabase.rpc('remove_org_member', {
      p_member_id: memberId,
    })
    if (err) throw err
  }

  /** Leave the current workspace (any role). */
  async function leaveOrganization() {
    const membership = currentMembership.value
    if (!membership) throw new Error('No organization selected')

    const { error: err } = await supabase.rpc('remove_org_member', {
      p_member_id: membership.id,
    })
    if (err) throw err

    if (import.meta.client && localStorage.getItem(STORAGE_KEY) === membership.organization_id) {
      localStorage.removeItem(STORAGE_KEY)
    }
    currentOrgId.value = null
    await fetchMemberships()
    if (!memberships.value.length) {
      await ensureOrganization()
    }
  }

  async function createOrganization(name: string) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Organization name is required')

    const { data: org, error: orgErr } = await supabase.rpc('create_organization', {
      p_name: trimmed,
    })
    if (orgErr) throw orgErr

    await fetchMemberships()
    if (org?.id) setCurrentOrg(org.id)
    return org as Organization
  }

  async function deleteOrganization(orgId: string) {
    const membership = memberships.value.find((m) => m.organization_id === orgId)
    if (!membership || membership.role !== 'owner') {
      throw new Error('Only owners can delete a workspace')
    }

    const { error: err } = await supabase.from('organizations').delete().eq('id', orgId)
    if (err) throw err

    if (import.meta.client && localStorage.getItem(STORAGE_KEY) === orgId) {
      localStorage.removeItem(STORAGE_KEY)
    }
    if (currentOrgId.value === orgId) {
      currentOrgId.value = null
    }

    await fetchMemberships()
    if (!memberships.value.length) {
      await ensureOrganization()
    }
  }

  /** True when the header should show org name + role (hide for default Personal). */
  const showOrgBadge = computed(() => {
    const org = currentOrganization.value
    if (!org) return false
    return org.name.trim().toLowerCase() !== 'personal'
  })

  return {
    memberships,
    currentOrgId,
    currentOrganization,
    currentMembership,
    role,
    canWrite,
    isViewer,
    isOwner,
    isEnterprise,
    deviceLimit,
    showOrgBadge,
    loading,
    ready,
    error,
    fetchMemberships,
    ensureOrganization,
    clearOrganizationState,
    setCurrentOrg,
    requireWrite,
    requireOrgId,
    renameOrganization,
    listMembers,
    addMemberByEmail,
    updateMemberRole,
    removeMember,
    leaveOrganization,
    createOrganization,
    deleteOrganization,
  }
}

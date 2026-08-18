import type {
  DeviceProfile,
  DeviceProfileCredentials,
  ProfileBulkDeviceInput,
  SchemaField,
} from '~/types'

function normalizeProfile(row: any): DeviceProfile {
  return {
    id: row.id,
    organization_id: row.organization_id,
    user_id: row.user_id,
    name: row.name,
    device_model: row.device_model || '',
    firmware_version: row.firmware_version || '',
    schema_definition: Array.isArray(row.schema_definition) ? row.schema_definition : [],
    identity_field: row.identity_field || 'device_id',
    fleet_key_id: row.fleet_key_id,
    fleet_secret_preview: row.fleet_secret_preview ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

let profilesInflight: Promise<void> | null = null

export function useProfiles() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const { currentOrgId, requireOrgId, requireWrite, ensureOrganization } = useOrganization()

  const profiles = useState<DeviceProfile[]>('device-profiles', () => [])
  const loading = useState('device-profiles-loading', () => false)
  const error = useState<string | null>('device-profiles-error', () => null)
  const loadedForOrg = useState<string | null>('device-profiles-loaded-org', () => null)

  async function hasAuth(): Promise<boolean> {
    if (user.value) return true
    const { data } = await supabase.auth.getSession()
    return !!data.session?.user
  }

  async function fetchProfiles(opts?: { force?: boolean }) {
    if (!(await hasAuth())) return

    if (profilesInflight && !opts?.force) {
      return profilesInflight
    }

    const run = async () => {
      const cacheHit = !!loadedForOrg.value && loadedForOrg.value === currentOrgId.value
      if (!cacheHit) loading.value = true
      error.value = null
      try {
        await ensureOrganization()
        const orgId = currentOrgId.value
        if (!orgId) {
          profiles.value = []
          loadedForOrg.value = null
          return
        }

        const { data, error: err } = await supabase
          .from('device_profiles')
          .select(
            'id, organization_id, user_id, name, device_model, firmware_version, schema_definition, identity_field, fleet_key_id, fleet_secret_preview, created_at, updated_at',
          )
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })

        if (err) throw err
        profiles.value = (data || []).map(normalizeProfile)
        loadedForOrg.value = orgId
      } catch (e: any) {
        error.value = e?.message || 'Failed to load profiles'
        // Keep stale cache on transient errors
      } finally {
        loading.value = false
      }
    }

    profilesInflight = run().finally(() => {
      profilesInflight = null
    })
    return profilesInflight
  }

  function invalidateProfileCache() {
    loadedForOrg.value = null
  }

  async function createProfile(input: {
    name: string
    deviceModel: string
    firmwareVersion: string
    schemaDefinition: SchemaField[]
    identityField: string
  }) {
    await ensureOrganization()
    requireWrite()
    const orgId = requireOrgId()

    let response: {
      profile: DeviceProfile
      credentials: DeviceProfileCredentials
    }
    try {
      response = await $fetch('/api/profiles', {
        method: 'POST',
        body: {
          orgId,
          name: input.name,
          deviceModel: input.deviceModel,
          firmwareVersion: input.firmwareVersion,
          schemaDefinition: input.schemaDefinition,
          identityField: input.identityField,
        },
      })
    } catch (e: any) {
      throw new Error(e?.data?.message || e?.message || 'Failed to create device profile')
    }

    const profile = normalizeProfile(response.profile)
    profiles.value = [profile, ...profiles.value]
    loadedForOrg.value = orgId
    return response
  }

  async function previewProfileProvision(profileId: string, devices: ProfileBulkDeviceInput[]) {
    await ensureOrganization()
    requireWrite()
    const orgId = requireOrgId()

    try {
      return await $fetch('/api/profiles/provision/preview', {
        method: 'POST',
        body: { orgId, profileId, devices },
      })
    } catch (e: any) {
      throw new Error(
        e?.data?.message || e?.message || 'Failed to calculate provisioning cost',
      )
    }
  }

  async function confirmProfileProvision(profileId: string, importId: string) {
    await ensureOrganization()
    requireWrite()
    const orgId = requireOrgId()

    try {
      return await $fetch('/api/profiles/provision', {
        method: 'POST',
        body: { orgId, profileId, importId },
      })
    } catch (e: any) {
      const err = new Error(
        e?.data?.message || e?.message || 'Failed to complete provisioning',
      ) as Error & { refreshRequired?: boolean }
      err.refreshRequired = !!e?.data?.data?.refreshRequired || !!e?.data?.refreshRequired
      throw err
    }
  }

  return {
    profiles,
    loading,
    error,
    fetchProfiles,
    invalidateProfileCache,
    createProfile,
    previewProfileProvision,
    confirmProfileProvision,
  }
}

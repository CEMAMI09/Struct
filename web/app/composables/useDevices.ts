import type {
  BulkDeviceInput,
  BulkDeviceImportResult,
  BulkUploadQuote,
  Device,
  DeviceSchema,
  DeviceTags,
  SchemaField,
  SchemaVersion,
} from '~/types'
import { formatMacAddress } from '#shared/bulkUpload'
import type { Json } from '~/types/database.types'

const DEVICE_FIELDS = 'id,user_id,organization_id,name,api_key,key_id,api_secret_preview,protocol_version,mac_address,last_seen,created_at,tags,encryption_enabled,profile_id,hardware_id'

function normalizeDevice(row: any): Device {
  const keyId = row.key_id || row.api_key || ''
  return {
    id: row.id,
    user_id: row.user_id,
    organization_id: row.organization_id,
    name: row.name,
    api_key: keyId,
    key_id: keyId,
    api_secret_preview: row.api_secret_preview ?? null,
    protocol_version: Number(row.protocol_version) || 2,
    mac_address: row.mac_address ?? null,
    last_seen: row.last_seen ?? null,
    created_at: row.created_at,
    tags: (row.tags && typeof row.tags === 'object' ? row.tags : {}) as DeviceTags,
    encryption_enabled: !!row.encryption_enabled,
    profile_id: row.profile_id ?? null,
    hardware_id: row.hardware_id ?? null,
  }
}

function normalizeSchema(row: any): DeviceSchema {
  return {
    id: row.id,
    device_id: row.device_id,
    organization_id: row.organization_id,
    schema_definition: Array.isArray(row.schema_definition) ? row.schema_definition : [],
    version: Number(row.version) >= 1 ? Number(row.version) : 1,
    updated_at: row.updated_at,
  }
}

function normalizeSchemaVersion(row: any): SchemaVersion {
  return {
    id: row.id,
    device_id: row.device_id,
    version: row.version,
    schema_definition: Array.isArray(row.schema_definition) ? row.schema_definition as SchemaField[] : [],
    created_at: row.created_at,
  }
}

function schemaDefinitionJson(definition: SchemaField[]): Json {
  return definition.map(field => {
    if (field.type === 'flags') {
      return { name: field.name, type: field.type, bits: field.bits.map(bit => ({ name: bit.name, bit: bit.bit })) }
    }
    if (field.type === 'char') return { name: field.name, type: field.type, length: field.length }
    return { name: field.name, type: field.type }
  })
}

function definitionsEqual(a: SchemaField[], b: SchemaField[]) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const devicesInflightByApp = new WeakMap<object, {
  promise: Promise<void> | null
  orgId: string | null
  generation: number
}>()

export function useDevices() {
  const app = useNuxtApp()
  if (!devicesInflightByApp.has(app)) devicesInflightByApp.set(app, { promise: null, orgId: null, generation: 0 })
  const inflight = devicesInflightByApp.get(app)!
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const { currentOrgId, requireOrgId, requireWrite, ensureOrganization } = useOrganization()

  const devices = useState<Device[]>('devices', () => [])
  const schemas = useState<Record<string, DeviceSchema>>('schemas', () => ({}))
  const schemaVersions = useState<Record<string, SchemaVersion[]>>('schema-versions', () => ({}))
  const loading = useState('devices-loading', () => false)
  const error = useState<string | null>('devices-error', () => null)
  /** Org id for which devices/schemas were last successfully loaded (incl. empty). */
  const loadedForOrg = useState<string | null>('devices-loaded-org', () => null)
  const devicesLoaded = computed(() =>
    !!loadedForOrg.value && loadedForOrg.value === currentOrgId.value && !loading.value,
  )

  async function hasAuth(): Promise<boolean> {
    if (user.value) return true
    const { data } = await supabase.auth.getSession()
    return !!data.session?.user
  }

  async function fetchDevices(opts?: { force?: boolean }) {
    if (!(await hasAuth())) return

    try {
      await ensureOrganization()
    } catch (e: any) {
      error.value = e.message || 'Failed to load devices'
      return
    }
    const orgId = currentOrgId.value
    if (inflight.promise && inflight.orgId === orgId && !opts?.force) return inflight.promise
    const generation = ++inflight.generation

    if (loadedForOrg.value !== orgId) {
      devices.value = []
      schemas.value = {}
      schemaVersions.value = {}
      loadedForOrg.value = null
    }

    const run = async () => {
      const cacheHit = !!loadedForOrg.value && loadedForOrg.value === orgId
      // SWR: only show spinner on cold load / org switch
      if (!cacheHit) loading.value = true
      error.value = null
      try {
        if (!orgId) {
          devices.value = []
          schemas.value = {}
          schemaVersions.value = {}
          loadedForOrg.value = null
          return
        }

        const { data, error: err } = await supabase
          .from('devices')
          .select(DEVICE_FIELDS)
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })

        if (err) throw err
        if (generation !== inflight.generation || currentOrgId.value !== orgId) return
        const fetchedDevices = (data || []).map(normalizeDevice)

        let nextSchemas: Record<string, DeviceSchema> = {}
        if (fetchedDevices.length) {
          const schemaResult = await supabase.from('schemas')
            .select('id,device_id,organization_id,schema_definition,version,updated_at')
            .eq('organization_id', orgId)
          if (schemaResult.error) throw schemaResult.error

          for (const row of schemaResult.data || []) {
            const schema = normalizeSchema(row)
            nextSchemas[schema.device_id] = schema
          }
        }
        if (generation !== inflight.generation || currentOrgId.value !== orgId) return
        devices.value = fetchedDevices
        schemas.value = nextSchemas
        // Historical versions are loaded only when a device is opened in Schema.
        const deviceIds = new Set(fetchedDevices.map(device => device.id))
        schemaVersions.value = Object.fromEntries(
          Object.entries(schemaVersions.value).filter(([id]) => deviceIds.has(id)),
        )
        loadedForOrg.value = orgId
      } catch (e: any) {
        if (generation === inflight.generation && currentOrgId.value === orgId) {
          error.value = e.message || 'Failed to load devices'
        }
      } finally {
        if (generation === inflight.generation) loading.value = false
      }
    }

    const promise = run().finally(() => {
      if (inflight.promise === promise) {
        inflight.promise = null
        inflight.orgId = null
      }
    })
    inflight.promise = promise
    inflight.orgId = orgId
    return inflight.promise
  }

  function invalidateDeviceCache() {
    loadedForOrg.value = null
  }

  async function createDevice(name: string) {
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
      throw new Error('Not authenticated — sign out and sign in again')
    }

    await ensureOrganization()
    requireWrite()
    const organization_id = requireOrgId()

    let response: { device: any; credentials?: { keyId: string; apiSecret: string } }
    try {
      response = await $fetch<{ device: any; credentials?: { keyId: string; apiSecret: string } }>('/api/devices', {
        method: 'POST',
        body: { name, orgId: organization_id },
      })
    } catch (e: any) {
      const message =
        e?.statusCode === 402
          ? e?.data?.message ||
            'Free tier supports up to 5 devices. Upgrade your plan to add more.'
          : e?.data?.message || e.message || 'Failed to create device'
      throw new Error(message)
    }

    const device = normalizeDevice(response.device)
    devices.value = [device, ...devices.value]
    // The API created the empty schema before returning the one-time secret.
    // Do not risk losing that secret to a follow-up read or usage refresh error.
    schemas.value = {
      ...schemas.value,
      [device.id]: {
        id: '',
        device_id: device.id,
        organization_id,
        schema_definition: [],
        version: 1,
        updated_at: new Date().toISOString(),
      },
    }
    schemaVersions.value = {
      ...schemaVersions.value,
      [device.id]: [],
    }

    void fetchMembershipsFromOrg().catch(() => {})
    return { device, credentials: response.credentials ?? null }
  }

  async function previewBulkUpload(rows: BulkDeviceInput[]): Promise<BulkUploadQuote> {
    await ensureOrganization()
    requireWrite()
    const organization_id = requireOrgId()

    try {
      return await $fetch<BulkUploadQuote>('/api/devices/bulk/preview', {
        method: 'POST',
        body: { orgId: organization_id, devices: rows },
      })
    } catch (e: any) {
      const message =
        e?.data?.message || e?.message || 'Failed to calculate bulk upload cost'
      throw new Error(message)
    }
  }

  async function confirmBulkUpload(importId: string) {
    await ensureOrganization()
    requireWrite()
    const organization_id = requireOrgId()

    let response: BulkDeviceImportResult
    try {
      response = await $fetch<BulkDeviceImportResult>('/api/devices/bulk', {
        method: 'POST',
        body: { orgId: organization_id, importId },
      })
    } catch (e: any) {
      const err = new Error(
        e?.data?.message || e?.message || 'Failed to complete bulk upload',
      ) as Error & { refreshRequired?: boolean }
      err.refreshRequired = !!e?.data?.data?.refreshRequired || !!e?.data?.refreshRequired
      throw err
    }

    const created = (response.devices || []).map(normalizeDevice)
    if (created.length) {
      const createdIds = new Set(created.map(device => device.id))
      devices.value = [...created, ...devices.value.filter(device => !createdIds.has(device.id))]
      for (const device of created) {
        schemas.value = {
          ...schemas.value,
          [device.id]: {
            id: '',
            device_id: device.id,
            organization_id: device.organization_id,
            schema_definition: [],
            version: 1,
            updated_at: new Date().toISOString(),
          },
        }
        schemaVersions.value = {
          ...schemaVersions.value,
          [device.id]: [],
        }
      }
    }

    // Return one-time secrets before any optional refresh can fail.
    void fetchDevices({ force: true }).catch(() => {})
    void fetchMembershipsFromOrg().catch(() => {})
    return response
  }

  async function fetchMembershipsFromOrg() {
    const { fetchMemberships } = useOrganization()
    await fetchMemberships()
  }

  async function deleteDevice(id: string) {
    requireWrite()
    const organization_id = requireOrgId()

    try {
      await $fetch(`/api/devices/${id}?orgId=${encodeURIComponent(organization_id)}`, {
        method: 'DELETE',
      })
    } catch (e: any) {
      throw new Error(e?.data?.message || e.message || 'Failed to delete device')
    }

    devices.value = devices.value.filter((d) => d.id !== id)
    const next = { ...schemas.value }
    delete next[id]
    schemas.value = next
    const nextVers = { ...schemaVersions.value }
    delete nextVers[id]
    schemaVersions.value = nextVers

    await fetchMembershipsFromOrg()
  }

  async function rotateDeviceApiKey(id: string) {
    requireWrite()
    const organization_id = requireOrgId()

    let response: { device: any; credentials?: { keyId: string; apiSecret: string } }
    try {
      response = await $fetch<{ device: any; credentials?: { keyId: string; apiSecret: string } }>(`/api/devices/${id}/key`, {
        method: 'POST',
        body: { orgId: organization_id },
      })
    } catch (e: any) {
      throw new Error(e?.data?.message || e.message || 'Failed to rotate API key')
    }

    const device = normalizeDevice(response.device)
    devices.value = devices.value.map((existing) =>
      existing.id === id ? device : existing,
    )
    return { device, credentials: response.credentials ?? null }
  }

  async function updateDeviceTags(id: string, tags: DeviceTags) {
    requireWrite()
    const { data, error: err } = await supabase
      .from('devices')
      .update({ tags })
      .eq('id', id)
      .select(DEVICE_FIELDS)
      .single()
    if (err) throw err
    const device = normalizeDevice(data)
    devices.value = devices.value.map((d) => (d.id === id ? device : d))
    return device
  }

  async function setDeviceEncryption(id: string, enabled: boolean): Promise<string | null> {
    requireWrite()
    const { data, error: err } = await supabase.rpc('configure_device_encryption', {
      p_device_id: id,
      p_enabled: enabled,
      p_rotate: false,
    })
    if (err) throw err
    devices.value = devices.value.map((device) =>
      device.id === id ? { ...device, encryption_enabled: enabled } : device,
    )
    return typeof data === 'string' ? data : null
  }

  async function rotateEncryptionKey(id: string): Promise<string> {
    requireWrite()
    const { data, error: err } = await supabase.rpc('configure_device_encryption', {
      p_device_id: id,
      p_enabled: true,
      p_rotate: true,
    })
    if (err) throw err
    devices.value = devices.value.map((device) =>
      device.id === id ? { ...device, encryption_enabled: true } : device,
    )
    if (typeof data !== 'string') throw new Error('Encryption key was not returned')
    return data
  }

  async function getDeviceEncryptionKey(id: string): Promise<string> {
    requireWrite()
    const { data, error: err } = await supabase.rpc('get_device_encryption_key', {
      p_device_id: id,
    })
    if (err) throw err
    if (typeof data !== 'string') throw new Error('Encryption key is not available')
    return data
  }

  async function saveSchema(deviceId: string, definition: SchemaField[]) {
    requireWrite()
    const expectedVersion = schemas.value[deviceId]?.version || 1
    const { data, error: err } = await supabase.rpc('publish_device_schema', {
      p_device_id: deviceId,
      p_definition: schemaDefinitionJson(definition),
      p_expected_version: expectedVersion,
    })
    if (err) throw err
    const saved = normalizeSchema(Array.isArray(data) ? data[0] : data)
    schemas.value = { ...schemas.value, [deviceId]: saved }
    const { data: versions, error: versionError } = await supabase.from('schema_versions')
      .select('id,device_id,version,schema_definition,created_at').eq('device_id', deviceId).order('version', { ascending: true })
    if (versionError) throw versionError
    schemaVersions.value = { ...schemaVersions.value, [deviceId]: (versions || []).map(normalizeSchemaVersion) }
    return saved
  }

  async function fetchSchemaVersions(deviceId: string, opts?: { force?: boolean }) {
    if (!opts?.force && schemaVersions.value[deviceId]) return
    const orgId = requireOrgId()
    if (!devices.value.some(device => device.id === deviceId && device.organization_id === orgId)) {
      throw new Error('Select a device in this workspace')
    }
    const { data, error: err } = await supabase.from('schema_versions')
      .select('id,device_id,version,schema_definition,created_at')
      .eq('device_id', deviceId)
      .order('version', { ascending: true })
    if (err) throw err
    if (currentOrgId.value !== orgId) return
    schemaVersions.value = { ...schemaVersions.value, [deviceId]: (data || []).map(normalizeSchemaVersion) }
  }

  function subscribePresence() {
    let stopped = false
    let refreshing = false
    const refreshPresence = async () => {
      if (stopped || refreshing || document.visibilityState === 'hidden') return
      const orgId = currentOrgId.value
      const ids = devices.value.map((device) => device.id)
      if (!orgId || !ids.length) return
      refreshing = true
      try {
        const latest = new Map<string, string | null>()
        for (let offset = 0; offset < ids.length; offset += 200) {
          if (stopped || currentOrgId.value !== orgId) return
          const { data, error: err } = await supabase.from('devices')
            .select('id,last_seen')
            .eq('organization_id', orgId)
            .in('id', ids.slice(offset, offset + 200))
          if (err) throw err
          for (const row of data || []) latest.set(row.id, row.last_seen)
        }
        if (!stopped && currentOrgId.value === orgId) {
          devices.value = devices.value.map((device) =>
            latest.has(device.id) ? { ...device, last_seen: latest.get(device.id) ?? null } : device,
          )
        }
      } catch {
        // The next bounded poll or manual refresh can recover from a transient failure.
      } finally {
        refreshing = false
      }
    }
    const timer = setInterval(() => { void refreshPresence() }, 30_000)
    return () => { stopped = true; clearInterval(timer) }
  }

  return {
    devices,
    schemas,
    schemaVersions,
    loading,
    error,
    devicesLoaded,
    fetchDevices,
    invalidateDeviceCache,
    createDevice,
    previewBulkUpload,
    confirmBulkUpload,
    deleteDevice,
    rotateDeviceApiKey,
    updateDeviceTags,
    setDeviceEncryption,
    rotateEncryptionKey,
    getDeviceEncryptionKey,
    saveSchema,
    fetchSchemaVersions,
    subscribePresence,
    formatMacAddress,
  }
}

import type {
  BulkDeviceInput,
  BulkUploadQuote,
  Device,
  DeviceSchema,
  DeviceTags,
  SchemaField,
  SchemaVersion,
} from '~/types'
import { formatMacAddress } from '#shared/bulkUpload'

function randomEncryptionKeyHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function normalizeDevice(row: any): Device {
  const keyId = row.key_id || row.api_key || ''
  return {
    ...row,
    api_key: keyId,
    key_id: keyId,
    api_secret_preview: row.api_secret_preview ?? null,
    protocol_version: Number(row.protocol_version) || 2,
    organization_id: row.organization_id,
    mac_address: row.mac_address ?? null,
    tags: (row.tags && typeof row.tags === 'object' ? row.tags : {}) as DeviceTags,
    encryption_enabled: !!row.encryption_enabled,
    encryption_key: row.encryption_key ?? null,
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

function definitionsEqual(a: SchemaField[], b: SchemaField[]) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const devicesInflightByApp = new WeakMap<object, { promise: Promise<void> | null }>()

export function useDevices() {
  const app = useNuxtApp()
  if (!devicesInflightByApp.has(app)) devicesInflightByApp.set(app, { promise: null })
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

  async function hasAuth(): Promise<boolean> {
    if (user.value) return true
    const { data } = await supabase.auth.getSession()
    return !!data.session?.user
  }

  async function fetchDevices(opts?: { force?: boolean }) {
    if (!(await hasAuth())) return

    if (inflight.promise && !opts?.force) {
      return inflight.promise
    }

    const run = async () => {
      const cacheHit = !!loadedForOrg.value && loadedForOrg.value === currentOrgId.value
      // SWR: only show spinner on cold load / org switch
      if (!cacheHit) loading.value = true
      error.value = null
      try {
        await ensureOrganization()
        const orgId = currentOrgId.value
        if (!orgId) {
          devices.value = []
          schemas.value = {}
          schemaVersions.value = {}
          loadedForOrg.value = null
          return
        }

        const { data, error: err } = await supabase
          .from('devices')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })

        if (err) throw err
        devices.value = (data || []).map(normalizeDevice)

        const ids = devices.value.map((d) => d.id)
        if (ids.length) {
          const [schemaResult, versionsResult] = await Promise.all([
            supabase.from('schemas').select('*').in('device_id', ids),
            supabase
              .from('schema_versions')
              .select('*')
              .in('device_id', ids)
              .order('version', { ascending: true }),
          ])

          if (schemaResult.error) throw schemaResult.error
          if (versionsResult.error) throw versionsResult.error

          const map: Record<string, DeviceSchema> = {}
          for (const row of schemaResult.data || []) {
            const schema = normalizeSchema(row)
            map[schema.device_id] = schema
          }
          schemas.value = map

          const versionMap: Record<string, SchemaVersion[]> = {}
          for (const row of versionsResult.data || []) {
            const v = row as SchemaVersion
            if (!versionMap[v.device_id]) versionMap[v.device_id] = []
            versionMap[v.device_id]!.push(v)
          }
          schemaVersions.value = versionMap
        } else {
          schemas.value = {}
          schemaVersions.value = {}
        }
        loadedForOrg.value = orgId
      } catch (e: any) {
        error.value = e.message || 'Failed to load devices'
      } finally {
        loading.value = false
      }
    }

    inflight.promise = run().finally(() => {
      inflight.promise = null
    })
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

    const { data: schema, error: sErr } = await supabase
      .from('schemas')
      .select('*')
      .eq('device_id', device.id)
      .maybeSingle()

    if (sErr) throw sErr

    const { data: versionRows, error: vErr } = await supabase
      .from('schema_versions')
      .select('*')
      .eq('device_id', device.id)
      .order('version', { ascending: true })

    if (vErr) throw vErr

    devices.value = [device, ...devices.value]
    if (schema) {
      schemas.value = { ...schemas.value, [device.id]: normalizeSchema(schema) }
    }
    schemaVersions.value = {
      ...schemaVersions.value,
      [device.id]: (versionRows || []) as SchemaVersion[],
    }

    await fetchMembershipsFromOrg()
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

    let response: {
      importId: string
      devices: any[]
      alreadyCompleted?: boolean
    }
    try {
      response = await $fetch('/api/devices/bulk', {
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
      devices.value = [...created, ...devices.value]
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

    await fetchDevices()
    await fetchMembershipsFromOrg()
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
      .select()
      .single()
    if (err) throw err
    const device = normalizeDevice(data)
    devices.value = devices.value.map((d) => (d.id === id ? device : d))
    return device
  }

  async function setDeviceEncryption(id: string, enabled: boolean) {
    requireWrite()
    const existing = devices.value.find((d) => d.id === id)
    const patch: Record<string, unknown> = { encryption_enabled: enabled }

    if (enabled && !existing?.encryption_key) {
      patch.encryption_key = randomEncryptionKeyHex()
    }

    const { data, error: err } = await supabase
      .from('devices')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (err) throw err
    const device = normalizeDevice(data)
    devices.value = devices.value.map((d) => (d.id === id ? device : d))
    return device
  }

  async function rotateEncryptionKey(id: string) {
    requireWrite()
    const { data, error: err } = await supabase
      .from('devices')
      .update({
        encryption_enabled: true,
        encryption_key: randomEncryptionKeyHex(),
      })
      .eq('id', id)
      .select()
      .single()
    if (err) throw err
    const device = normalizeDevice(data)
    devices.value = devices.value.map((d) => (d.id === id ? device : d))
    return device
  }

  async function saveSchema(deviceId: string, definition: SchemaField[]) {
    requireWrite()
    const expectedVersion = schemas.value[deviceId]?.version || 1
    const { data, error: err } = await supabase.rpc('publish_device_schema', {
      p_device_id: deviceId,
      p_definition: definition,
      p_expected_version: expectedVersion,
    })
    if (err) throw err
    const saved = normalizeSchema(Array.isArray(data) ? data[0] : data)
    schemas.value = { ...schemas.value, [deviceId]: saved }
    const { data: versions, error: versionError } = await supabase.from('schema_versions')
      .select('*').eq('device_id', deviceId).order('version', { ascending: true })
    if (versionError) throw versionError
    schemaVersions.value = { ...schemaVersions.value, [deviceId]: (versions || []) as SchemaVersion[] }
    return saved
  }

  function subscribePresence() {
    const channel = supabase
      .channel('devices-presence')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'devices' },
        (payload) => {
          const updated = normalizeDevice(payload.new)
          if (currentOrgId.value && updated.organization_id !== currentOrgId.value) return
          devices.value = devices.value.map((d) =>
            d.id === updated.id ? { ...d, ...updated } : d,
          )
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }

  return {
    devices,
    schemas,
    schemaVersions,
    loading,
    error,
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
    saveSchema,
    subscribePresence,
    formatMacAddress,
  }
}

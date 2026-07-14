import type { Device, DeviceSchema, DeviceTags, SchemaField, SchemaVersion } from '~/types'

function randomApiKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let key = ''
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 16; i++) {
    key += alphabet[bytes[i] % alphabet.length]
  }
  return key
}

function randomEncryptionKeyHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function normalizeDevice(row: any): Device {
  return {
    ...row,
    tags: (row.tags && typeof row.tags === 'object' ? row.tags : {}) as DeviceTags,
    encryption_enabled: !!row.encryption_enabled,
    encryption_key: row.encryption_key ?? null,
  }
}

function normalizeSchema(row: any): DeviceSchema {
  return {
    id: row.id,
    device_id: row.device_id,
    schema_definition: Array.isArray(row.schema_definition) ? row.schema_definition : [],
    version: Number(row.version) >= 1 ? Number(row.version) : 1,
    updated_at: row.updated_at,
  }
}

function definitionsEqual(a: SchemaField[], b: SchemaField[]) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function useDevices() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const devices = useState<Device[]>('devices', () => [])
  const schemas = useState<Record<string, DeviceSchema>>('schemas', () => ({}))
  const schemaVersions = useState<Record<string, SchemaVersion[]>>('schema-versions', () => ({}))
  const loading = useState('devices-loading', () => false)
  const error = useState<string | null>('devices-error', () => null)

  async function fetchSchemaVersions(deviceIds: string[]) {
    if (!deviceIds.length) {
      schemaVersions.value = {}
      return
    }
    const { data, error: err } = await supabase
      .from('schema_versions')
      .select('*')
      .in('device_id', deviceIds)
      .order('version', { ascending: true })

    if (err) throw err
    const map: Record<string, SchemaVersion[]> = {}
    for (const row of data || []) {
      const v = row as SchemaVersion
      if (!map[v.device_id]) map[v.device_id] = []
      map[v.device_id]!.push(v)
    }
    schemaVersions.value = map
  }

  async function fetchDevices() {
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user && !user.value) return

    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('devices')
        .select('*')
        .order('created_at', { ascending: false })

      if (err) throw err
      devices.value = (data || []).map(normalizeDevice)

      const ids = devices.value.map((d) => d.id)
      if (ids.length) {
        const { data: schemaRows, error: sErr } = await supabase
          .from('schemas')
          .select('*')
          .in('device_id', ids)

        if (sErr) throw sErr
        const map: Record<string, DeviceSchema> = {}
        for (const row of schemaRows || []) {
          const schema = normalizeSchema(row)
          map[schema.device_id] = schema
        }
        schemas.value = map
        await fetchSchemaVersions(ids)
      } else {
        schemas.value = {}
        schemaVersions.value = {}
      }
    } catch (e: any) {
      error.value = e.message || 'Failed to load devices'
    } finally {
      loading.value = false
    }
  }

  async function createDevice(name: string) {
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
      throw new Error('Not authenticated — sign out and sign in again')
    }

    const api_key = randomApiKey()

    const { data, error: err } = await supabase
      .from('devices')
      .insert({
        name,
        api_key,
        user_id: authData.user.id,
        tags: {},
        encryption_enabled: false,
      })
      .select()
      .single()

    if (err) throw err

    const device = normalizeDevice(data)

    const { data: schema, error: sErr } = await supabase
      .from('schemas')
      .insert({ device_id: device.id, schema_definition: [], version: 1 })
      .select()
      .single()

    if (sErr) throw sErr

    const { data: verRow, error: vErr } = await supabase
      .from('schema_versions')
      .insert({
        device_id: device.id,
        version: 1,
        schema_definition: [],
      })
      .select()
      .single()

    if (vErr) throw vErr

    devices.value = [device, ...devices.value]
    schemas.value = { ...schemas.value, [device.id]: normalizeSchema(schema) }
    schemaVersions.value = {
      ...schemaVersions.value,
      [device.id]: [verRow as SchemaVersion],
    }
    return device
  }

  async function deleteDevice(id: string) {
    const { error: err } = await supabase.from('devices').delete().eq('id', id)
    if (err) throw err
    devices.value = devices.value.filter((d) => d.id !== id)
    const next = { ...schemas.value }
    delete next[id]
    schemas.value = next
    const nextVers = { ...schemaVersions.value }
    delete nextVers[id]
    schemaVersions.value = nextVers
  }

  async function updateDeviceTags(id: string, tags: DeviceTags) {
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

  /**
   * Persist schema. Bumps the wire version when replacing a non-empty layout
   * so fleets still on older structs keep parsing via schema_versions.
   */
  async function saveSchema(deviceId: string, definition: SchemaField[]) {
    const existing = schemas.value[deviceId]
    const prevDef = existing?.schema_definition || []
    const prevVer = existing?.version || 1

    if (existing && definitionsEqual(prevDef, definition)) {
      return existing
    }

    const shouldBump = prevDef.length > 0
    const nextVersion = shouldBump ? prevVer + 1 : prevVer || 1
    if (nextVersion > 255) {
      throw new Error('Schema version limit (255) reached — create a new device key')
    }

    if (existing) {
      const { data, error: err } = await supabase
        .from('schemas')
        .update({
          schema_definition: definition,
          version: nextVersion,
          updated_at: new Date().toISOString(),
        })
        .eq('device_id', deviceId)
        .select()
        .single()
      if (err) throw err

      const { data: verRow, error: vErr } = await supabase
        .from('schema_versions')
        .upsert(
          {
            device_id: deviceId,
            version: nextVersion,
            schema_definition: definition,
          },
          { onConflict: 'device_id,version' },
        )
        .select()
        .single()
      if (vErr) throw vErr

      const normalized = normalizeSchema(data)
      schemas.value = { ...schemas.value, [deviceId]: normalized }

      const list = [...(schemaVersions.value[deviceId] || [])]
      const idx = list.findIndex((v) => v.version === nextVersion)
      if (idx >= 0) list[idx] = verRow as SchemaVersion
      else list.push(verRow as SchemaVersion)
      list.sort((a, b) => a.version - b.version)
      schemaVersions.value = { ...schemaVersions.value, [deviceId]: list }

      return normalized
    }

    const { data, error: err } = await supabase
      .from('schemas')
      .insert({
        device_id: deviceId,
        schema_definition: definition,
        version: nextVersion,
      })
      .select()
      .single()
    if (err) throw err

    const { data: verRow, error: vErr } = await supabase
      .from('schema_versions')
      .insert({
        device_id: deviceId,
        version: nextVersion,
        schema_definition: definition,
      })
      .select()
      .single()
    if (vErr) throw vErr

    const normalized = normalizeSchema(data)
    schemas.value = { ...schemas.value, [deviceId]: normalized }
    schemaVersions.value = {
      ...schemaVersions.value,
      [deviceId]: [verRow as SchemaVersion],
    }
    return normalized
  }

  function subscribePresence() {
    const channel = supabase
      .channel('devices-presence')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'devices' },
        (payload) => {
          const updated = normalizeDevice(payload.new)
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
    createDevice,
    deleteDevice,
    updateDeviceTags,
    setDeviceEncryption,
    rotateEncryptionKey,
    saveSchema,
    subscribePresence,
  }
}

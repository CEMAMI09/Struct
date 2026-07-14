import type { Device, DeviceSchema, DeviceTags, SchemaField } from '~/types'

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

export function useDevices() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const devices = useState<Device[]>('devices', () => [])
  const schemas = useState<Record<string, DeviceSchema>>('schemas', () => ({}))
  const loading = useState('devices-loading', () => false)
  const error = useState<string | null>('devices-error', () => null)

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
        for (const row of (schemaRows || []) as DeviceSchema[]) {
          map[row.device_id] = row
        }
        schemas.value = map
      } else {
        schemas.value = {}
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
      .insert({ device_id: device.id, schema_definition: [] })
      .select()
      .single()

    if (sErr) throw sErr

    devices.value = [device, ...devices.value]
    schemas.value = { ...schemas.value, [device.id]: schema as DeviceSchema }
    return device
  }

  async function deleteDevice(id: string) {
    const { error: err } = await supabase.from('devices').delete().eq('id', id)
    if (err) throw err
    devices.value = devices.value.filter((d) => d.id !== id)
    const next = { ...schemas.value }
    delete next[id]
    schemas.value = next
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
    if (!enabled) {
      // keep key around so re-enabling reuses same secret (enterprise convenience)
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

  async function saveSchema(deviceId: string, definition: SchemaField[]) {
    const existing = schemas.value[deviceId]
    if (existing) {
      const { data, error: err } = await supabase
        .from('schemas')
        .update({
          schema_definition: definition,
          updated_at: new Date().toISOString(),
        })
        .eq('device_id', deviceId)
        .select()
        .single()
      if (err) throw err
      schemas.value = { ...schemas.value, [deviceId]: data as DeviceSchema }
      return data as DeviceSchema
    }

    const { data, error: err } = await supabase
      .from('schemas')
      .insert({ device_id: deviceId, schema_definition: definition })
      .select()
      .single()
    if (err) throw err
    schemas.value = { ...schemas.value, [deviceId]: data as DeviceSchema }
    return data as DeviceSchema
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

import type { Device, DeviceSchema, SchemaField } from '~/types'

function randomApiKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let key = ''
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 16; i++) {
    key += alphabet[bytes[i] % alphabet.length]
  }
  return key
}

export function useDevices() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const devices = useState<Device[]>('devices', () => [])
  const schemas = useState<Record<string, DeviceSchema>>('schemas', () => ({}))
  const loading = useState('devices-loading', () => false)
  const error = useState<string | null>('devices-error', () => null)

  async function fetchDevices() {
    // Prefer live JWT — useSupabaseUser can be briefly null right after reload
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
      devices.value = (data || []) as Device[]

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
    // Prefer live auth user from JWT — useSupabaseUser can be briefly stale
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
      throw new Error('Not authenticated — sign out and sign in again')
    }

    const api_key = randomApiKey()

    // user_id comes from auth.uid() DB default + explicit match to JWT
    const { data, error: err } = await supabase
      .from('devices')
      .insert({
        name,
        api_key,
        user_id: authData.user.id,
      })
      .select()
      .single()

    if (err) throw err

    const device = data as Device

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
          const updated = payload.new as Device
          devices.value = devices.value.map((d) => (d.id === updated.id ? { ...d, ...updated } : d))
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
    saveSchema,
    subscribePresence,
  }
}

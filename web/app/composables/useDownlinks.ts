import type { PendingCommand } from '~/types'

/**
 * Pack downlink commands into little-endian binary framed as:
 *   [uint8 cmd_id][payload…]
 *
 * cmd_id:
 *   0x01 set_interval — uint32 seconds LE
 *   0x02 reboot       — no payload
 *   0xFF custom       — raw hex bytes follow
 */
export function packDownlinkCommand(
  commandType: string,
  payload: Record<string, unknown>,
): Buffer {
  if (typeof Buffer === 'undefined') {
    // Browser path via Uint8Array → we'll use a shared hex helper below
    throw new Error('Use packDownlinkCommandHex in the browser')
  }
  return Buffer.from(packDownlinkBytes(commandType, payload))
}

export function packDownlinkCommandHex(
  commandType: string,
  payload: Record<string, unknown>,
): string {
  const bytes = packDownlinkBytes(commandType, payload)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function packDownlinkBytes(
  commandType: string,
  payload: Record<string, unknown>,
): Uint8Array {
  const type = commandType.toLowerCase()

  if (type === 'set_interval') {
    const secs = Number(payload.interval_sec ?? payload.seconds ?? 0) >>> 0
    const out = new Uint8Array(5)
    out[0] = 0x01
    new DataView(out.buffer).setUint32(1, secs, true)
    return out
  }

  if (type === 'reboot') {
    return new Uint8Array([0x02])
  }

  // custom hex
  const hex = String(payload.hex || '').replace(/\s+/g, '')
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Custom command hex must be an even-length hex string')
  }
  const raw = new Uint8Array(hex.length / 2 + 1)
  raw[0] = 0xff
  for (let i = 0; i < hex.length; i += 2) {
    raw[1 + i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return raw
}

export function useDownlinks() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const { requireWrite } = useOrganization()

  const commands = useState<PendingCommand[]>('pending-commands', () => [])
  const loading = useState('downlinks-loading', () => false)
  const error = useState<string | null>('downlinks-error', () => null)

  async function fetchCommands(deviceId?: string) {
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user && !user.value) return

    loading.value = true
    error.value = null
    try {
      let q = supabase
        .from('pending_commands')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (deviceId) q = q.eq('device_id', deviceId)

      const { data, error: err } = await q
      if (err) throw err
      commands.value = (data || []) as PendingCommand[]
    } catch (e: any) {
      error.value = e.message || 'Failed to load commands'
    } finally {
      loading.value = false
    }
  }

  async function sendCommand(
    deviceId: string,
    commandType: string,
    payload: Record<string, unknown>,
  ) {
    requireWrite()
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr || !authData.user) {
      throw new Error('Not authenticated — sign out and sign in again')
    }

    const packed_hex = packDownlinkCommandHex(commandType, payload)

    const { data, error: err } = await supabase
      .from('pending_commands')
      .insert({
        device_id: deviceId,
        user_id: authData.user.id,
        command_type: commandType,
        payload,
        packed_hex,
        status: 'pending',
      })
      .select()
      .single()

    if (err) throw err
    commands.value = [data as PendingCommand, ...commands.value]
    return data as PendingCommand
  }

  return {
    commands,
    loading,
    error,
    fetchCommands,
    sendCommand,
    packDownlinkCommandHex,
  }
}

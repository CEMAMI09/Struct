import type { TelemetryRow } from '~/types'

const telemetryControlByApp = new WeakMap<object, {
  fetchGeneration: number
  subscriptionGeneration: number
  pendingLive: TelemetryRow[]
}>()

function mergeRows(existing: TelemetryRow[], incoming: TelemetryRow[], limit: number): TelemetryRow[] {
  const byId = new Map<string, TelemetryRow>()
  for (const row of [...existing, ...incoming]) byId.set(row.id, row)
  return [...byId.values()]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-limit)
}

export function useTelemetry() {
  const app = useNuxtApp()
  if (!telemetryControlByApp.has(app)) {
    telemetryControlByApp.set(app, { fetchGeneration: 0, subscriptionGeneration: 0, pendingLive: [] })
  }
  const control = telemetryControlByApp.get(app)!
  const supabase = useSupabaseClient()
  const { telemetryRetentionDays } = useEntitlements()

  const rows = useState<TelemetryRow[]>('telemetry-rows', () => [])
  const live = useState('telemetry-live', () => false)
  const connectionStatus = useState<'connecting' | 'connected' | 'unavailable'>(
    'telemetry-connection-status', () => 'unavailable',
  )
  const selectedDeviceId = useState<string | null>('telemetry-device', () => null)
  const rowsDeviceId = useState<string | null>('telemetry-rows-device', () => null)

  async function fetchTelemetry(deviceId: string, limit = 50) {
    const replace = rowsDeviceId.value !== null && rowsDeviceId.value !== deviceId
    selectedDeviceId.value = deviceId
    const generation = ++control.fetchGeneration
    const retentionStart = new Date(
      Date.now() - telemetryRetentionDays.value * 24 * 60 * 60 * 1000,
    ).toISOString()
    const { data, error } = await supabase
      .from('telemetry')
      .select('*')
      .eq('device_id', deviceId)
      .gte('timestamp', retentionStart)
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (error) {
      if (generation !== control.fetchGeneration || selectedDeviceId.value !== deviceId) return
      throw error
    }
    if (generation !== control.fetchGeneration || selectedDeviceId.value !== deviceId) return
    const incoming = (data || []) as TelemetryRow[]
    if (replace) {
      const buffered = control.pendingLive.filter((row) => row.device_id === deviceId)
      control.pendingLive = control.pendingLive.filter((row) => row.device_id !== deviceId)
      rows.value = mergeRows(buffered, incoming, limit)
    } else {
      rows.value = mergeRows(rows.value, incoming, limit)
    }
    rowsDeviceId.value = deviceId
  }

  function subscribe(deviceId: string) {
    selectedDeviceId.value = deviceId
    const generation = ++control.subscriptionGeneration
    let active = true
    live.value = false
    connectionStatus.value = 'connecting'

    const channel = supabase
      .channel(`telemetry:${deviceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'telemetry',
          filter: `device_id=eq.${deviceId}`,
        },
        (payload) => {
          if (!active || generation !== control.subscriptionGeneration || selectedDeviceId.value !== deviceId) return
          const row = payload.new as TelemetryRow
          if (rowsDeviceId.value && rowsDeviceId.value !== deviceId) {
            control.pendingLive.push(row)
            return
          }
          rows.value = mergeRows(rows.value, [row], 100)
        },
      )
      .subscribe((status) => {
        if (!active || generation !== control.subscriptionGeneration || selectedDeviceId.value !== deviceId) return
        if (status === 'SUBSCRIBED') {
          live.value = true
          connectionStatus.value = 'connected'
          // Backfill after subscription to close the gap between first fetch and live events.
          void fetchTelemetry(deviceId).catch(() => {})
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          live.value = false
          connectionStatus.value = 'unavailable'
        }
      })

    return () => {
      active = false
      if (generation === control.subscriptionGeneration) {
        control.subscriptionGeneration++
        live.value = false
        connectionStatus.value = 'unavailable'
      }
      supabase.removeChannel(channel)
    }
  }

  return {
    rows,
    live,
    connectionStatus,
    selectedDeviceId,
    fetchTelemetry,
    subscribe,
  }
}

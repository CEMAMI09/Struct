import type { TelemetryRow } from '~/types'

export function useTelemetry() {
  const supabase = useSupabaseClient()
  const { telemetryRetentionDays } = useEntitlements()

  const rows = useState<TelemetryRow[]>('telemetry-rows', () => [])
  const live = useState('telemetry-live', () => false)
  const selectedDeviceId = useState<string | null>('telemetry-device', () => null)

  async function fetchTelemetry(deviceId: string, limit = 50) {
    selectedDeviceId.value = deviceId
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

    if (error) throw error
    rows.value = ((data || []) as TelemetryRow[]).reverse()
  }

  function subscribe(deviceId: string) {
    selectedDeviceId.value = deviceId
    live.value = true

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
          const row = payload.new as TelemetryRow
          rows.value = [...rows.value.slice(-99), row]
        },
      )
      .subscribe()

    return () => {
      live.value = false
      supabase.removeChannel(channel)
    }
  }

  return {
    rows,
    live,
    selectedDeviceId,
    fetchTelemetry,
    subscribe,
  }
}

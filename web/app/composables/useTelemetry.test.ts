import { afterEach, expect, it, vi } from 'vitest'
import { useTelemetry } from './useTelemetry'

afterEach(() => vi.unstubAllGlobals())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup() {
  const app = {}
  const state = new Map<string, { value: unknown }>()
  const pending = new Map<string, Array<ReturnType<typeof deferred<{ data: unknown[]; error: null }>>>>()
  const channels: Array<{ event?: (payload: unknown) => void; status?: (value: string) => void }> = []
  vi.stubGlobal('useNuxtApp', () => app)
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!state.has(key)) state.set(key, { value: init() })
    return state.get(key)
  })
  vi.stubGlobal('useEntitlements', () => ({ telemetryRetentionDays: { value: 30 } }))
  vi.stubGlobal('useSupabaseClient', () => ({
    from: () => {
      const query: any = {
        select: () => query,
        eq: (_column: string, id: string) => {
          query.response = deferred<{ data: unknown[]; error: null }>()
          pending.set(id, [...(pending.get(id) || []), query.response])
          return query
        },
        gte: () => query,
        order: () => query,
        limit: () => query,
        then: (success: (value: unknown) => unknown, failure?: (reason: unknown) => unknown) =>
          query.response.promise.then(success, failure),
      }
      return query
    },
    channel: () => {
      const channel: any = {}
      channel.on = (_type: string, _filter: unknown, event: (payload: unknown) => void) => {
        channel.event = event
        return channel
      }
      channel.subscribe = (status: (value: string) => void) => {
        channel.status = status
        channels.push(channel)
        return channel
      }
      return channel
    },
    removeChannel: () => {},
  }))
  return { api: useTelemetry(), pending, channels }
}

const row = (id: string, deviceId: string, second: number) => ({
  id, device_id: deviceId, timestamp: `2026-09-26T00:00:${String(second).padStart(2, '0')}Z`, parsed_json: { value: second },
})

it('does not show a stale device response after selecting another device', async () => {
  const { api, pending } = setup()
  const first = api.fetchTelemetry('device-a')
  const second = api.fetchTelemetry('device-b')
  pending.get('device-b')![0]!.resolve({ data: [row('b', 'device-b', 2)], error: null })
  await second
  pending.get('device-a')![0]!.resolve({ data: [row('a', 'device-a', 1)], error: null })
  await first
  expect(api.rows.value.map(item => item.id)).toEqual(['b'])
})

it('reports live only after subscription and retains a live row during history backfill', async () => {
  const { api, pending, channels } = setup()
  const unsubscribe = api.subscribe('device-a')
  expect(api.live.value).toBe(false)
  expect(api.connectionStatus.value).toBe('connecting')
  const fetch = api.fetchTelemetry('device-a')
  channels[0]!.event!({ new: row('live', 'device-a', 2) })
  pending.get('device-a')![0]!.resolve({ data: [row('stored', 'device-a', 1)], error: null })
  await fetch
  expect(api.rows.value.map(item => item.id)).toEqual(['stored', 'live'])
  channels[0]!.status!('SUBSCRIBED')
  expect(api.live.value).toBe(true)
  pending.get('device-a')![1]!.resolve({ data: [row('stored', 'device-a', 1), row('live', 'device-a', 2)], error: null })
  await Promise.resolve()
  unsubscribe()
  expect(api.live.value).toBe(false)
})

it('removes expired history on refresh while keeping a live event received during the request', async () => {
  const { api, pending, channels } = setup()
  const unsubscribe = api.subscribe('device-a')
  const first = api.fetchTelemetry('device-a')
  pending.get('device-a')![0]!.resolve({ data: [row('old', 'device-a', 1)], error: null })
  await first

  const refresh = api.fetchTelemetry('device-a')
  channels[0]!.event!({ new: row('live', 'device-a', 3) })
  pending.get('device-a')![1]!.resolve({ data: [row('stored', 'device-a', 2)], error: null })
  await refresh

  expect(api.rows.value.map(item => item.id)).toEqual(['stored', 'live'])
  unsubscribe()
})

it('clears old device data when no device remains selected', async () => {
  const { api, pending } = setup()
  const first = api.fetchTelemetry('device-a')
  pending.get('device-a')![0]!.resolve({ data: [row('old', 'device-a', 1)], error: null })
  await first
  expect(api.rows.value).toHaveLength(1)

  api.clearTelemetry()
  expect(api.rows.value).toEqual([])
  expect(api.selectedDeviceId.value).toBeNull()
})

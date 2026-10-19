import { afterEach, it, expect, vi } from 'vitest'
import { computed } from 'vue'
import { useDevices } from './useDevices'
afterEach(() => vi.unstubAllGlobals())
it('bounds compatibility selectors and loads a deep-linked device outside the first page', async () => {
  const state = new Map(),
    calls: any[] = []
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { fleetEnabled: true } }))
  vi.stubGlobal('useNuxtApp', () => ({
    $router: { currentRoute: { value: { query: { device: 'deep' } } } },
  }))
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!state.has(key)) state.set(key, { value: init() })
    return state.get(key)
  })
  vi.stubGlobal('useSupabaseUser', () => ({ value: { id: 'user' } }))
  vi.stubGlobal('useOrganization', () => ({
    currentOrgId: { value: 'org' },
    ensureOrganization: async () => {},
  }))
  vi.stubGlobal('useSupabaseClient', () => ({
    from: (table: string) => {
      const op: any = { table },
        q: any = {
          select: () => q,
          eq: (col: string, v: string) => {
            op[col] = v
            return q
          },
          not: () => q,
          order: () => q,
          limit: (n: number) => {
            op.limit = n
            return q
          },
          in: (_col: string, ids: string[]) => {
            op.ids = ids
            return q
          },
          then: (done: any) => {
            calls.push(op)
            return Promise.resolve({
              data:
                table === 'schemas'
                  ? []
                  : op.id
                    ? [{ id: 'deep', name: 'Deep link' }]
                    : [{ id: 'recent', name: 'Recent' }],
              error: null,
            }).then(done)
          },
        }
      return q
    },
  }))
  const store = useDevices()
  await store.fetchDevices()
  expect(
    calls.filter((c) => c.table === 'devices').map((c) => c.limit),
  ).toEqual([100, 1])
  expect(calls.find((c) => c.table === 'schemas').ids).toEqual([
    'deep',
    'recent',
  ])
  expect(store.devices.value.map((d) => d.id)).toEqual(['deep', 'recent'])
})

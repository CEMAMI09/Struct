import { afterEach, expect, it, vi } from 'vitest'
import { useDevices } from './useDevices'
import { useDestinations } from './useDestinations'

afterEach(() => vi.unstubAllGlobals())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

it.each([
  [useDevices, 'fetchDevices', 'devices', 'devices'],
  [useDestinations, 'fetchDestinations', 'destinations', 'destinations'],
] as const)('%s ignores a response from the previous organization', async (factory, fetchName, stateName, table) => {
  const app = {}
  const state = new Map<string, { value: unknown }>()
  const org = { value: 'org-a' }
  const pending = new Map<string, ReturnType<typeof deferred<{ data: unknown[]; error: null }>>>()
  const selected: string[] = []

  vi.stubGlobal('useNuxtApp', () => app)
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!state.has(key)) state.set(key, { value: init() })
    return state.get(key)
  })
  vi.stubGlobal('useSupabaseUser', () => ({ value: { id: 'user' } }))
  vi.stubGlobal('useOrganization', () => ({
    currentOrgId: org,
    ensureOrganization: async () => {},
  }))
  vi.stubGlobal('useSupabaseClient', () => ({
    from: (name: string) => {
      expect(name).toBe(table)
      const query: any = {
        select: (columns: string) => { selected.push(columns); return query },
        eq: (_column: string, id: string) => {
          query.response = deferred<{ data: unknown[]; error: null }>()
          pending.set(id, query.response)
          return query
        },
        order: () => query,
        then: (success: (value: unknown) => unknown, failure?: (reason: unknown) => unknown) =>
          query.response.promise.then(success, failure),
      }
      return query
    },
  }))

  const api = factory() as any
  const first = api[fetchName]()
  await vi.waitFor(() => expect(pending.has('org-a')).toBe(true))
  org.value = 'org-b'
  const second = api[fetchName]()
  await vi.waitFor(() => expect(pending.has('org-b')).toBe(true))
  pending.get('org-b')!.resolve({ data: [], error: null })
  await second
  pending.get('org-a')!.resolve({ data: [{ id: 'old-org-row' }], error: null })
  await first

  expect(api[stateName].value).toEqual([])
  expect(selected).toHaveLength(2)
  expect(selected.every(columns => !columns.includes('encryption_key') && !columns.includes('signing_secret') && !columns.includes('api_secret_encrypted'))).toBe(true)
  if (table === 'destinations') {
    expect(selected.every(columns => !columns.split(',').includes('url'))).toBe(true)
  }
})

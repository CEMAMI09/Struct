import { afterEach, expect, it, vi } from 'vitest'
import { useDestinations } from './useDestinations'
import { useAuditLogs } from './useAuditLogs'
import { useProfiles } from './useProfiles'

afterEach(() => vi.unstubAllGlobals())

it.each([
  [useDestinations, 'fetchDestinations', 'destinations'],
  [useAuditLogs, 'fetchAuditLogs', 'auditLogs'],
  [useProfiles, 'fetchProfiles', 'profiles'],
] as const)('%s keeps concurrent SSR requests independent', async (factory, fetchName, rowsName) => {
  const pending: Array<(value: unknown) => void> = []
  function makeRequest(id: string) {
    const state = new Map()
    const response = new Promise(resolve => pending.push(resolve))
    const query: any = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      then: response.then.bind(response),
    }
    vi.stubGlobal('useNuxtApp', () => (state))
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!state.has(key)) state.set(key, { value: init() })
      return state.get(key)
    })
    vi.stubGlobal('useSupabaseClient', () => ({ from: () => query }))
    vi.stubGlobal('useSupabaseUser', () => ({ value: { id } }))
    vi.stubGlobal('useOrganization', () => ({
      currentOrgId: { value: id }, isEnterprise: { value: true },
      ensureOrganization: async () => {},
    }))
    return factory() as any
  }
  const a = makeRequest('org-a')
  const first = a[fetchName]()
  await Promise.resolve()
  const b = makeRequest('org-b')
  const second = b[fetchName]()
  pending[1]!({ data: [{ id: 'b' }], error: null })
  pending[0]!({ data: [{ id: 'a' }], error: null })
  await Promise.all([first, second])
  expect(a[rowsName].value[0].id).toBe('a')
  expect(b[rowsName].value[0].id).toBe('b')
})

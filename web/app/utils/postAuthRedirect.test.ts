import { afterEach, describe, expect, it } from 'vitest'
import { AUTH_CALLBACK_BOOT_SCRIPT, authCallbackDestination, pendingAuthRedirect } from './postAuthRedirect'

function runBootScript(search: string, hash: string) {
  const store = new Map<string, string>()
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
  const location = { search, hash }
  // The boot script closes over location and sessionStorage from its caller.
  new Function('location', 'sessionStorage', AUTH_CALLBACK_BOOT_SCRIPT)(location, sessionStorage)
  return store.get('struct-post-auth') ?? null
}

describe('authCallbackDestination', () => {
  const cases: Array<[string, string, '/dashboard' | null]> = [
    ['?code=abc', '', '/dashboard'],
    ['', '#access_token=tok&type=signup', '/dashboard'],
    ['?token_hash=abc&type=signup', '', '/dashboard'],
    ['?token=abc&type=magiclink', '', '/dashboard'],
    ['?code=abc&type=recovery', '', null],
    ['?flow=recovery', '#access_token=tok&type=recovery', null],
    ['?error=access_denied', '', null],
    ['', '#error=server_error&type=signup', null],
    ['', '', null],
    ['?token=abc', '', null],
  ]

  it.each(cases)('maps %s %s to %s', (search, hash, expected) => {
    expect(authCallbackDestination(search, hash)).toBe(expected)
    expect(runBootScript(search, hash)).toBe(expected)
  })
})

describe('pendingAuthRedirect', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'sessionStorage')
  })

  function storage(initial?: string) {
    const store = new Map<string, string>()
    if (initial) store.set('struct-post-auth', initial)
    const sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }
    Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorage, configurable: true })
    return store
  }

  it('sends an auth return on the marketing page to the dashboard', () => {
    storage('/dashboard')
    expect(pendingAuthRedirect('/')).toBe('/dashboard')
  })

  it('stays on the dashboard and drops the stored return', () => {
    const store = storage('/dashboard')
    expect(pendingAuthRedirect('/dashboard')).toBe(null)
    expect(store.has('struct-post-auth')).toBe(false)
  })
})

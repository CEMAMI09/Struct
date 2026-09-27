export const POST_AUTH_STORAGE_KEY = 'struct-post-auth'

const EMAIL_LINK_TYPES = new Set(['signup', 'magiclink', 'invite', 'email', 'email_change'])

function readParams(search: string, hash: string) {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return { query, fragment }
}

/** Where a Supabase auth return should go. Recovery stays on the reset page. */
export function authCallbackDestination(search: string, hash: string): '/dashboard' | null {
  const { query, fragment } = readParams(search, hash)
  if (query.get('error') || fragment.get('error')) return null

  const type = fragment.get('type') || query.get('type') || ''
  if (type === 'recovery' || query.get('flow') === 'recovery') return null

  const emailLink = (query.has('token_hash') || query.has('token')) && EMAIL_LINK_TYPES.has(type)
  if (query.has('code') || fragment.has('access_token') || emailLink) return '/dashboard'
  return null
}

/**
 * Runs in document head, before the Supabase client strips the callback URL.
 * Keep the conditions aligned with authCallbackDestination.
 */
export const AUTH_CALLBACK_BOOT_SCRIPT =
  "(function(){try{var q=new URLSearchParams(location.search);var h=new URLSearchParams((location.hash||'').replace(/^#/,''));if(q.get('error')||h.get('error')){sessionStorage.removeItem('struct-post-auth');return}var type=h.get('type')||q.get('type')||'';if(type==='recovery'||q.get('flow')==='recovery')return;var email=(q.has('token_hash')||q.has('token'))&&(type==='signup'||type==='magiclink'||type==='invite'||type==='email'||type==='email_change');if(q.has('code')||h.has('access_token')||email)sessionStorage.setItem('struct-post-auth','/dashboard')}catch(e){}})();"

function authStorage(): Storage | null {
  if (typeof globalThis.sessionStorage === 'undefined') return null
  return globalThis.sessionStorage
}

export function noteAuthCallback(search: string, hash: string) {
  const storage = authStorage()
  if (!storage) return
  const destination = authCallbackDestination(search, hash)
  if (destination) {
    storage.setItem(POST_AUTH_STORAGE_KEY, destination)
    return
  }
  const { query, fragment } = readParams(search, hash)
  if (query.get('error') || fragment.get('error')) {
    storage.removeItem(POST_AUTH_STORAGE_KEY)
  }
}

/** Dashboard redirect for a stored auth return, or null when this page should stay. */
export function pendingAuthRedirect(pathname: string): '/dashboard' | null {
  const storage = authStorage()
  if (!storage) return null
  if (storage.getItem(POST_AUTH_STORAGE_KEY) !== '/dashboard') return null
  if (
    pathname === '/reset-password' ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/')
  ) {
    storage.removeItem(POST_AUTH_STORAGE_KEY)
    return null
  }
  return '/dashboard'
}

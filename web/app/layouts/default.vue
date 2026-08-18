<template>
  <div class="app-shell flex min-h-screen min-w-0">
    <button
      v-if="navOpen"
      type="button"
      class="fixed inset-0 z-40 bg-black/50 md:hidden"
      aria-label="Close navigation"
      @click="navOpen = false"
    />

    <AppSidebar
      :open="navOpen"
      :collapsed="navCollapsed"
      @close="navOpen = false"
      @toggle-collapse="toggleNavCollapsed"
    />

    <main class="flex min-h-screen min-w-0 flex-1 flex-col overflow-hidden">
      <header class="app-topbar">
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            class="btn-ghost shrink-0 px-2.5 py-2 md:hidden"
            aria-label="Open menu"
            :aria-expanded="navOpen"
            @click="navOpen = true"
          >
            <span class="flex flex-col gap-[3px]" aria-hidden="true">
              <span class="block h-0.5 w-4 rounded bg-current" />
              <span class="block h-0.5 w-4 rounded bg-current" />
              <span class="block h-0.5 w-4 rounded bg-current" />
            </span>
          </button>
          <div class="min-w-0">
            <h1 class="truncate text-[0.9375rem] font-medium tracking-tight text-[#E8EAEF]">
              {{ title }}
            </h1>
          </div>
        </div>
        <div class="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
          <NuxtLink
            v-if="showOrgBadge && currentOrganization"
            to="/dashboard/organization"
            class="app-org"
            title="Organization settings"
          >
            <span class="truncate">{{ currentOrganization.name }}</span>
            <span class="app-org-role" :class="isViewer ? 'is-muted' : ''">
              {{ role || '—' }}
            </span>
          </NuxtLink>
          <span class="hidden max-w-[10rem] truncate text-xs text-[#8B93A7] lg:inline lg:max-w-none">
            {{ userEmail }}
          </span>
          <button class="btn-ghost text-xs" type="button" :disabled="signingOut" @click="signOut">
            {{ signingOut ? 'Signing out…' : 'Sign out' }}
          </button>
        </div>
      </header>
      <div class="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
        <p
          v-if="orgError"
          class="mb-4 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-300"
        >
          Could not load your organizations: {{ orgError }}
        </p>
        <p
          v-if="isViewer"
          class="mb-4 rounded-lg border border-[#252830] bg-[#14161c] px-3 py-2 text-xs text-[#8B93A7]"
        >
          You have <span class="text-[#E8EAEF]">viewer</span> access — you can inspect devices,
          schemas, and telemetry, but cannot create or edit.
        </p>
        <div class="min-h-0 min-w-0">
          <slot />
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const NAV_COLLAPSED_KEY = 'struct-nav-collapsed'
const navOpen = ref(false)
const navCollapsed = ref(false)

function toggleNavCollapsed() {
  navCollapsed.value = !navCollapsed.value
  if (import.meta.client) {
    localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed.value ? '1' : '0')
  }
}

const {
  currentOrganization,
  role,
  isViewer,
  showOrgBadge,
  canWrite,
  error: orgError,
  ensureOrganization,
  clearOrganizationState,
  fetchUsageStats,
} = useOrganization()
const { syncFromStripe } = useBilling()

const userEmail = computed(() => user.value?.email || '')
const signingOut = ref(false)
let bootstrapInflight: Promise<void> | null = null
let bootstrappedForUser: string | null = null

const title = computed(() => {
  const map: Record<string, string> = {
    '/dashboard': 'Overview',
    '/dashboard/schema': 'Schema',
    '/dashboard/debugger': 'Debugger',
    '/dashboard/devices': 'Devices',
    '/dashboard/profiles': 'Profiles',
    '/dashboard/profiles/new': 'New profile',
    '/dashboard/destinations': 'Destinations',
    '/dashboard/organization': 'Organization',
    '/dashboard/settings': 'Settings',
    '/dashboard/audit-logs': 'Audit log',
  }
  return map[route.path] || 'Struct'
})

watch(
  () => route.fullPath,
  () => {
    navOpen.value = false
  },
)

async function bootstrapOrg() {
  const uid = user.value?.id || null
  if (bootstrapInflight) return bootstrapInflight
  if (uid && bootstrappedForUser === uid) {
    // Already warm for this session — refresh usage quietly, never block on Stripe.
    void fetchUsageStats()
    return
  }

  const run = async () => {
    await ensureOrganization()
    bootstrappedForUser = user.value?.id || uid

    // Usage for the header is cheap; don't wait for Stripe.
    void fetchUsageStats()

    // Stripe sync is billing hygiene — run in the background so pages paint immediately.
    if (canWrite.value && currentOrganization.value?.stripe_customer_id) {
      void syncFromStripe()
    }
  }

  bootstrapInflight = run().finally(() => {
    bootstrapInflight = null
  })
  return bootstrapInflight
}

onMounted(() => {
  if (import.meta.client) {
    navCollapsed.value = localStorage.getItem(NAV_COLLAPSED_KEY) === '1'
  }
  bootstrapOrg().catch(() => {})
})

watch(user, (u, prev) => {
  if (u && u.id !== prev?.id) {
    bootstrappedForUser = null
    bootstrapOrg().catch(() => {})
  }
})

async function signOut() {
  if (signingOut.value) return
  signingOut.value = true
  bootstrappedForUser = null
  clearOrganizationState()
  try {
    // Prefer local scope so a network hang can't block logout forever.
    await Promise.race([
      supabase.auth.signOut({ scope: 'local' }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Sign out timed out')), 4000),
      ),
    ])
  } catch (e) {
    console.error('Sign out failed', e)
    // Best-effort wipe of auth storage if the client hung.
    if (import.meta.client) {
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.includes('supabase') || key.startsWith('sb-')) {
            localStorage.removeItem(key)
          }
        }
      } catch {
        /* ignore */
      }
    }
  } finally {
    await navigateTo('/login', { replace: true, external: true })
    signingOut.value = false
  }
}
</script>

<style scoped>
.app-topbar {
  display: flex;
  height: 3.5rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid #252830;
  padding: 0 1rem;
  background: #0c0d10;
}

@media (min-width: 768px) {
  .app-topbar {
    padding: 0 1.5rem;
  }
}

.app-org {
  display: none;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid #252830;
  border-radius: 8px;
  padding: 0.3rem 0.55rem 0.3rem 0.7rem;
  font-size: 0.75rem;
  color: #e8eaef;
  transition: border-color 0.15s ease;
}

@media (min-width: 640px) {
  .app-org {
    display: flex;
  }
}

.app-org:hover {
  border-color: #3a4050;
}

.app-org-role {
  flex-shrink: 0;
  border: 1px solid #252830;
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
  font-size: 0.65rem;
  text-transform: capitalize;
  color: #9aa3b2;
}

.app-org-role.is-muted {
  color: #6b7380;
}
</style>


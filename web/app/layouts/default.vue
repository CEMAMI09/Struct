<template>
  <div class="flex min-h-screen min-w-0">
    <button
      v-if="navOpen"
      type="button"
      class="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] md:hidden"
      aria-label="Close navigation"
      @click="navOpen = false"
    />

    <AppSidebar :open="navOpen" @close="navOpen = false" />

    <main class="flex min-h-screen min-w-0 flex-1 flex-col overflow-hidden">
      <header
        class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[#2A2F3A] px-4 md:px-6"
      >
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
            <p class="text-xs uppercase tracking-widest text-[#8B93A7]">{{ sectionLabel }}</p>
            <h1 class="truncate text-base font-semibold text-[#E8EAEF]">{{ title }}</h1>
          </div>
        </div>
        <div class="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
          <NuxtLink
            v-if="showOrgBadge && currentOrganization"
            to="/dashboard/organization"
            class="hidden min-w-0 items-center gap-2 rounded-lg border border-[#2A2F3A] px-2.5 py-1.5 transition hover:border-[#38B6FF]/40 sm:flex"
            title="Organization settings"
          >
            <span class="truncate text-xs text-[#E8EAEF]">{{ currentOrganization.name }}</span>
            <span
              class="shrink-0 rounded border border-[#2A2F3A] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              :class="isViewer ? 'text-[#8B93A7]' : 'text-[#38B6FF]'"
            >
              {{ role || '—' }}
            </span>
          </NuxtLink>
          <span class="mono hidden max-w-[10rem] truncate text-xs text-[#8B93A7] lg:inline lg:max-w-none">
            {{ userEmail }}
          </span>
          <button class="btn-ghost text-xs" @click="signOut">Sign out</button>
        </div>
      </header>
      <div class="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
        <p
          v-if="isViewer"
          class="mb-4 rounded-lg border border-[#2A2F3A] bg-[#1A1D24] px-3 py-2 text-xs text-[#8B93A7]"
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
const navOpen = ref(false)

const { currentOrganization, role, isViewer, showOrgBadge, ensureOrganization } = useOrganization()

const userEmail = computed(() => user.value?.email || '')

const title = computed(() => {
  const map: Record<string, string> = {
    '/dashboard': 'Overview',
    '/dashboard/schema': 'Schema Builder',
    '/dashboard/debugger': 'Live Debugger',
    '/dashboard/devices': 'Fleet',
    '/dashboard/destinations': 'Destinations',
    '/dashboard/organization': 'Organization',
    '/dashboard/settings': 'Settings',
    '/dashboard/audit-logs': 'Audit Log',
  }
  return map[route.path] || 'Struct'
})

const sectionLabel = computed(() => {
  if (route.path.includes('organization')) return 'Team'
  if (route.path.includes('settings')) return 'Account'
  if (route.path.includes('audit-logs')) return 'Govern'
  if (route.path.includes('schema')) return 'Define'
  if (route.path.includes('debugger')) return 'Inspect'
  if (route.path.includes('devices')) return 'Fleet'
  if (route.path.includes('destinations')) return 'Route'
  return 'Monitor'
})

watch(
  () => route.fullPath,
  () => {
    navOpen.value = false
  },
)

onMounted(() => {
  ensureOrganization().catch(() => {})
})

watch(user, (u) => {
  if (u) ensureOrganization().catch(() => {})
})

async function signOut() {
  await supabase.auth.signOut()
  navigateTo('/login')
}
</script>

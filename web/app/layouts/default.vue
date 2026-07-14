<template>
  <div class="flex min-h-screen">
    <AppSidebar />
    <main class="flex min-h-screen flex-1 flex-col overflow-hidden">
      <header class="flex h-14 shrink-0 items-center justify-between border-b border-[#2A2F3A] px-6">
        <div>
          <p class="text-xs uppercase tracking-widest text-[#8B93A7]">{{ sectionLabel }}</p>
          <h1 class="text-base font-semibold text-[#E8EAEF]">{{ title }}</h1>
        </div>
        <div class="flex items-center gap-3">
          <span class="mono hidden text-xs text-[#8B93A7] sm:inline">{{ userEmail }}</span>
          <button class="btn-ghost text-xs" @click="signOut">Sign out</button>
        </div>
      </header>
      <div class="flex-1 overflow-auto p-6">
        <slot />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const user = useSupabaseUser()
const supabase = useSupabaseClient()

const userEmail = computed(() => user.value?.email || '')

const title = computed(() => {
  const map: Record<string, string> = {
    '/dashboard': 'Overview',
    '/dashboard/schema': 'Schema Builder',
    '/dashboard/debugger': 'Live Debugger',
    '/dashboard/devices': 'Devices',
  }
  return map[route.path] || 'Struct'
})

const sectionLabel = computed(() => {
  if (route.path.includes('schema')) return 'Define'
  if (route.path.includes('debugger')) return 'Inspect'
  if (route.path.includes('devices')) return 'Fleet'
  return 'Monitor'
})

async function signOut() {
  await supabase.auth.signOut()
  navigateTo('/login')
}
</script>

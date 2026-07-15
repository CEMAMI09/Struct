<template>
  <aside
    class="fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 flex-col border-r border-[#2A2F3A] bg-[#0F1115] transition-transform duration-200 ease-out md:static md:translate-x-0 md:bg-[#0F1115]/80"
    :class="open ? 'translate-x-0' : '-translate-x-full'"
  >
    <div class="flex h-[4.5rem] items-center justify-between border-b border-[#2A2F3A] px-3 md:justify-center">
      <NuxtLink
        to="/dashboard"
        class="flex min-w-0 flex-1 items-center justify-center"
        @click="emit('close')"
      >
        <StructLogo size="sm" />
      </NuxtLink>
      <button
        type="button"
        class="btn-ghost ml-1 shrink-0 px-2 py-2 md:hidden"
        aria-label="Close menu"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>

    <nav class="flex flex-1 flex-col gap-1 p-3">
      <NuxtLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition md:min-h-0 md:py-2"
        :class="
          isActive(link.to)
            ? 'bg-[#1A1D24] text-[#38B6FF]'
            : 'text-[#8B93A7] hover:bg-[#1A1D24]/60 hover:text-[#E8EAEF]'
        "
        @click="emit('close')"
      >
        <span class="font-mono text-xs opacity-60">{{ link.glyph }}</span>
        {{ link.label }}
      </NuxtLink>
    </nav>

    <div class="border-t border-[#2A2F3A] p-4">
      <p class="text-[10px] uppercase tracking-wider text-[#8B93A7]">Ingestion</p>
      <p class="mt-1 font-mono text-xs text-[#E8EAEF]">TCP :{{ tcpPort }}</p>
    </div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  open?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const route = useRoute()
const config = useRuntimeConfig()
const tcpPort = computed(() => config.public.tcpPort)
const { isEnterprise } = useOrganization()

const links = computed(() => [
  { to: '/dashboard', label: 'Dashboard', glyph: '01' },
  { to: '/dashboard/devices', label: 'Devices', glyph: '02' },
  { to: '/dashboard/destinations', label: 'Destinations', glyph: '03' },
  { to: '/dashboard/schema', label: 'Schema', glyph: '04' },
  { to: '/dashboard/debugger', label: 'Debugger', glyph: '05' },
  { to: '/dashboard/organization', label: 'Organization', glyph: '06' },
  { to: '/dashboard/settings', label: 'Settings', glyph: '07' },
  ...(isEnterprise.value
    ? [{ to: '/dashboard/audit-logs', label: 'Audit Log', glyph: '08' }]
    : []),
])

function isActive(path: string) {
  if (path === '/dashboard') return route.path === '/dashboard'
  return route.path.startsWith(path)
}
</script>

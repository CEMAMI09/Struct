<template>
  <aside class="flex w-56 shrink-0 flex-col border-r border-[#2A2F3A] bg-[#0F1115]/80">
    <div class="flex h-14 items-center justify-center border-b border-[#2A2F3A] px-3">
      <NuxtLink to="/dashboard" class="flex w-full items-center justify-center">
        <StructLogo size="sm" class="max-w-[140px]" />
      </NuxtLink>
    </div>

    <nav class="flex flex-1 flex-col gap-1 p-3">
      <NuxtLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition"
        :class="
          isActive(link.to)
            ? 'bg-[#1A1D24] text-[#38B6FF]'
            : 'text-[#8B93A7] hover:bg-[#1A1D24]/60 hover:text-[#E8EAEF]'
        "
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
const route = useRoute()
const config = useRuntimeConfig()
const tcpPort = computed(() => config.public.tcpPort)

const links = [
  { to: '/dashboard', label: 'Dashboard', glyph: '01' },
  { to: '/dashboard/devices', label: 'Devices', glyph: '02' },
  { to: '/dashboard/destinations', label: 'Destinations', glyph: '03' },
  { to: '/dashboard/schema', label: 'Schema', glyph: '04' },
  { to: '/dashboard/debugger', label: 'Debugger', glyph: '05' },
]

function isActive(path: string) {
  if (path === '/dashboard') return route.path === '/dashboard'
  return route.path.startsWith(path)
}
</script>

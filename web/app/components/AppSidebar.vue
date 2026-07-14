<template>
  <aside class="flex w-56 shrink-0 flex-col border-r border-[#2A2F3A] bg-[#0F1115]/80">
    <div class="flex h-14 items-center gap-2 border-b border-[#2A2F3A] px-4">
      <span
        class="flex h-8 w-8 items-center justify-center rounded-md bg-[#00FFA3]/15 font-mono text-sm font-bold text-[#00FFA3]"
      >
        S
      </span>
      <div>
        <p class="text-sm font-semibold leading-none text-[#E8EAEF]">Struct</p>
        <p class="mt-0.5 font-mono text-[10px] text-[#8B93A7]">v0.1.0-mvp</p>
      </div>
    </div>

    <nav class="flex flex-1 flex-col gap-1 p-3">
      <NuxtLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition"
        :class="
          isActive(link.to)
            ? 'bg-[#1A1D24] text-[#00FFA3]'
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
  { to: '/dashboard/schema', label: 'Schema', glyph: '03' },
  { to: '/dashboard/debugger', label: 'Debugger', glyph: '04' },
]

function isActive(path: string) {
  if (path === '/dashboard') return route.path === '/dashboard'
  return route.path.startsWith(path)
}
</script>

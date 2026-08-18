<template>
  <aside
    class="app-side"
    :class="[
      open ? 'translate-x-0' : '-translate-x-full',
      collapsed ? 'w-60 md:w-[4.5rem]' : 'w-60',
    ]"
  >
    <div class="app-side-brand" :class="collapsed ? 'md:justify-center md:px-2' : ''">
      <NuxtLink
        to="/dashboard"
        class="flex min-w-0 items-center"
        :class="collapsed ? 'md:justify-center' : ''"
        @click="emit('close')"
      >
        <StructLogo size="sm" />
      </NuxtLink>
      <button
        type="button"
        class="btn-ghost ml-auto shrink-0 px-2 py-1.5 md:hidden"
        aria-label="Close menu"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <nav class="flex flex-1 flex-col gap-0.5 p-2" :class="collapsed ? 'md:px-2' : 'px-2.5'">
      <NuxtLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="app-nav-link"
        :class="[
          collapsed ? 'md:justify-center md:px-2' : 'px-2.5',
          isActive(link.to) ? 'is-active' : '',
        ]"
        :title="collapsed ? link.label : undefined"
        @mouseenter="prefetch(link.to)"
        @focus="prefetch(link.to)"
        @click="emit('close')"
      >
        <span class="app-nav-icon" aria-hidden="true" v-html="link.icon" />
        <span :class="collapsed ? 'md:hidden' : ''">{{ link.label }}</span>
      </NuxtLink>
    </nav>

    <div class="app-side-foot" :class="collapsed ? 'p-2 md:px-2' : 'p-3'">
      <button
        type="button"
        class="btn-ghost hidden w-full items-center justify-center gap-2 px-2 py-1.5 text-xs md:flex"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!collapsed"
        @click="emit('toggle-collapse')"
      >
        <span aria-hidden="true">{{ collapsed ? '→' : '←' }}</span>
        <span :class="collapsed ? 'md:hidden' : ''">Collapse</span>
      </button>
      <p :class="collapsed ? 'md:hidden' : ''" class="app-side-meta">
        TCP :{{ tcpPort }}
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  open?: boolean
  collapsed?: boolean
}>()

const emit = defineEmits<{
  close: []
  'toggle-collapse': []
}>()

const route = useRoute()
const config = useRuntimeConfig()
const tcpPort = computed(() => config.public.tcpPort)
const { isEnterprise } = useOrganization()

const icon = {
  dashboard:
    '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.25"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.25"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.25"/><rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" stroke-width="1.25"/></svg>',
  devices:
    '<svg viewBox="0 0 16 16" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.25"/><path d="M6.5 2.5v1.5M9.5 2.5v1.5M6.5 12v1.5M9.5 12v1.5M2.5 6.5h1.5M2.5 9.5h1.5M12 6.5h1.5M12 9.5h1.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  profiles:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 11.5 8 4.5l4.5 7H3.5Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>',
  destinations:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  schema:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  debugger:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M5.5 4.5 2.75 8 5.5 11.5M10.5 4.5 13.25 8 10.5 11.5M9 3.5 7 12.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  organization:
    '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.25" stroke="currentColor" stroke-width="1.25"/><path d="M3.5 13c.6-2.2 2.2-3.4 4.5-3.4s3.9 1.2 4.5 3.4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  settings:
    '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.25"/><path d="M8 2.75v1.3M8 12v1.25M2.75 8h1.3M12 8h1.25M4.3 4.3l.92.92M10.78 10.78l.92.92M11.7 4.3l-.92.92M5.22 10.78l-.92.92" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  audit:
    '<svg viewBox="0 0 16 16" fill="none"><rect x="3.5" y="2.5" width="9" height="11" rx="1.2" stroke="currentColor" stroke-width="1.25"/><path d="M6 6h4M6 8.5h4M6 11h2.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
}

const links = computed(() => [
  { to: '/dashboard', label: 'Overview', icon: icon.dashboard },
  { to: '/dashboard/devices', label: 'Devices', icon: icon.devices },
  { to: '/dashboard/profiles', label: 'Profiles', icon: icon.profiles },
  { to: '/dashboard/destinations', label: 'Destinations', icon: icon.destinations },
  { to: '/dashboard/schema', label: 'Schema', icon: icon.schema },
  { to: '/dashboard/debugger', label: 'Debugger', icon: icon.debugger },
  { to: '/dashboard/organization', label: 'Organization', icon: icon.organization },
  { to: '/dashboard/settings', label: 'Settings', icon: icon.settings },
  ...(isEnterprise.value
    ? [{ to: '/dashboard/audit-logs', label: 'Audit log', icon: icon.audit }]
    : []),
])

function isActive(path: string) {
  if (path === '/dashboard') return route.path === '/dashboard'
  return route.path.startsWith(path)
}

function prefetch(path: string) {
  if (!import.meta.client) return
  if (
    path === '/dashboard' ||
    path === '/dashboard/devices' ||
    path === '/dashboard/schema' ||
    path === '/dashboard/debugger'
  ) {
    void useDevices().fetchDevices()
  } else if (path === '/dashboard/profiles') {
    void useProfiles().fetchProfiles()
  } else if (path === '/dashboard/destinations') {
    void Promise.all([useDevices().fetchDevices(), useDestinations().fetchDestinations()])
  } else if (path === '/dashboard/audit-logs') {
    void useAuditLogs().fetchAuditLogs()
  }
}
</script>

<style scoped>
.app-side {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 50;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid #252830;
  background: #0c0d10;
  transition: width 0.2s ease, transform 0.2s ease;
}

@media (min-width: 768px) {
  .app-side {
    position: static;
    transform: none;
  }
}

.app-side-brand {
  display: flex;
  height: 3.5rem;
  align-items: center;
  border-bottom: 1px solid #252830;
  padding: 0 0.85rem;
}

.app-side-brand :deep(.struct-logo) {
  height: 1.75rem;
  margin-inline: 0;
}

.app-nav-link {
  display: flex;
  min-height: 2.5rem;
  align-items: center;
  gap: 0.65rem;
  border-radius: 8px;
  font-size: 0.875rem;
  color: #9aa3b2;
  transition: background 0.12s ease, color 0.12s ease;
}

.app-nav-link:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #e8eaef;
}

.app-nav-link.is-active {
  background: #181b22;
  color: #f2f4f7;
}

.app-nav-icon {
  display: grid;
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  place-items: center;
}

.app-nav-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.app-side-foot {
  border-top: 1px solid #252830;
}

.app-side-meta {
  margin: 0.65rem 0.15rem 0;
  font-size: 0.75rem;
  color: #6b7380;
}
</style>

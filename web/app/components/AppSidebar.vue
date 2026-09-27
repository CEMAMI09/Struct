<template>
  <aside
    class="app-side"
    :class="[
      open ? 'translate-x-0' : '-translate-x-full',
      collapsed ? 'is-collapsed w-60 md:w-[4.5rem]' : 'w-60',
    ]"
  >
    <div class="app-side-brand">
      <NuxtLink to="/dashboard" class="brand-link" aria-label="Struct" @click="emit('close')">
        <span class="brand-swap">
          <img class="brand-full logo-for-dark" src="/structdarkmode.svg" alt="" />
          <img class="brand-full logo-for-light" src="/2.svg" alt="" />
        </span>
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

    <nav class="app-nav" :class="collapsed ? 'md:px-2' : 'px-2.5'" aria-label="Application">
      <div v-for="group in groups" :key="group.label" class="app-nav-group">
        <p class="app-nav-label" :class="collapsed ? 'md:hidden' : ''">{{ group.label }}</p>
        <NuxtLink
          v-for="link in group.links"
          :key="link.to"
          :to="link.to"
          class="app-nav-link"
          :class="[
            collapsed ? 'md:justify-center md:px-2' : 'px-2.5',
            isActive(link.to) ? 'is-active' : '',
          ]"
          :aria-current="isActive(link.to) ? 'page' : undefined"
          :title="collapsed ? link.label : undefined"
          @click="emit('close')"
        >
          <span class="app-nav-icon" aria-hidden="true" v-html="link.icon" />
          <span :class="collapsed ? 'md:hidden' : ''">{{ link.label }}</span>
        </NuxtLink>
      </div>
    </nav>

    <div class="app-side-foot" :class="collapsed ? 'p-2 md:px-2' : 'p-3'">
      <p class="app-side-meta" :class="collapsed ? 'md:hidden' : ''">
        <span>Beta</span>
        <span class="app-side-meta-mark" aria-hidden="true">·</span>
        <span>v1.01</span>
      </p>
      <button
        type="button"
        class="app-side-collapse"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!collapsed"
        @click="emit('toggle-collapse')"
      >
        <span aria-hidden="true">{{ collapsed ? '→' : '←' }}</span>
        <span :class="collapsed ? 'md:hidden' : ''">Collapse</span>
      </button>
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
  deliveries:
    '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
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

const groups = computed(() => [
  {
    label: 'Overview',
    links: [{ to: '/dashboard', label: 'Overview', icon: icon.dashboard }],
  },
  {
    label: 'Fleet',
    links: [
      { to: '/dashboard/devices', label: 'Devices', icon: icon.devices },
      { to: '/dashboard/profiles', label: 'Profiles', icon: icon.profiles },
    ],
  },
  {
    label: 'Device',
    links: [
      { to: '/dashboard/schema', label: 'Schema', icon: icon.schema },
      { to: '/dashboard/debugger', label: 'Diagnostics', icon: icon.debugger },
    ],
  },
  {
    label: 'Delivery',
    links: [
      { to: '/dashboard/destinations', label: 'Destinations', icon: icon.destinations },
      { to: '/dashboard/deliveries', label: 'Deliveries', icon: icon.deliveries },
    ],
  },
  {
    label: 'Workspace',
    links: [
      { to: '/dashboard/organization', label: 'Organization', icon: icon.organization },
      { to: '/dashboard/settings', label: 'Settings', icon: icon.settings },
      ...(isEnterprise.value
        ? [{ to: '/dashboard/audit-logs', label: 'Audit log', icon: icon.audit }]
        : []),
    ],
  },
])

function isActive(path: string) {
  if (path === '/dashboard') return route.path === '/dashboard'
  return route.path.startsWith(path)
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
  border-right: 1px solid var(--struct-border);
  background: var(--struct-bg);
  transition: width 0.28s ease, transform 0.28s ease;
}

@media (min-width: 768px) {
  .app-side {
    position: sticky;
    top: 0;
    align-self: flex-start;
    height: 100vh;
    height: 100dvh;
    transform: none;
  }
}

.app-side-brand {
  display: flex;
  height: 3.5rem;
  align-items: center;
  border-bottom: 1px solid var(--struct-border);
  padding: 0 0.85rem;
}

.brand-link {
  display: flex;
  min-width: 0;
  align-items: center;
}

.brand-swap {
  --brand-h: 2.25rem;
  --brand-aspect: 3.21778;
  /* Right edge of the icon inside the wordmark viewBox. */
  --brand-icon-end: 0.30805;
  height: var(--brand-h);
  width: calc(var(--brand-h) * var(--brand-aspect));
  overflow: hidden;
  flex: none;
  transition: width 0.28s ease;
}

.brand-full {
  display: block;
  height: var(--brand-h);
  width: calc(var(--brand-h) * var(--brand-aspect));
  max-width: none;
}

@media (min-width: 768px) {
  .app-side.is-collapsed .brand-swap {
    width: calc(var(--brand-h) * var(--brand-aspect) * var(--brand-icon-end));
  }
}

.app-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.5rem;
  overflow-y: auto;
  padding: 0.5rem 0.5rem;
}

.app-nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
}

.app-nav-group + .app-nav-group {
  border-top: 1px solid var(--struct-border);
  padding-top: 0.45rem;
}

.app-nav-label {
  margin: 0 0.5rem 0.1rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--struct-muted);
}

.app-nav-link {
  display: flex;
  min-height: 2.15rem;
  align-items: center;
  gap: 0.55rem;
  border-radius: 8px;
  font-size: 0.875rem;
  color: var(--struct-muted);
  transition: background 0.12s ease, color 0.12s ease;
}

.app-nav-link:hover {
  background: var(--struct-hover);
  color: var(--struct-text);
}

.app-nav-link.is-active {
  background: var(--struct-selected);
  color: var(--struct-text);
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
  border-top: 1px solid var(--struct-border);
}

.app-side-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--struct-muted);
}

.app-side-meta-mark {
  color: var(--struct-text);
  font-weight: 500;
}

.app-side-collapse {
  display: none;
  width: 100%;
  min-height: 2rem;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--struct-muted);
  font-size: 0.75rem;
}

.app-side-collapse:hover {
  background: var(--struct-hover);
  color: var(--struct-text);
}

@media (min-width: 768px) {
  .app-side:not(.is-collapsed) .app-side-meta {
    margin-bottom: 0.35rem;
  }

  .app-side-foot {
    display: block;
  }

  .app-side-collapse {
    display: flex;
  }
}
</style>

<template>
  <header class="site-header">
    <NuxtLink to="/" class="site-brand" aria-label="Struct home">
      <StructLogo lockup />
    </NuxtLink>

    <nav class="site-nav" aria-label="Primary">
      <a v-for="link in links" :key="link.href" :href="link.href">{{ link.label }}</a>
    </nav>

    <div class="site-actions">
      <template v-if="user">
        <NuxtLink to="/dashboard" class="btn-primary text-xs">Open dashboard</NuxtLink>
      </template>
      <template v-else>
        <NuxtLink to="/login" class="site-signin">Sign in</NuxtLink>
        <NuxtLink to="/signup" class="btn-primary text-xs">Get started</NuxtLink>
      </template>
      <button
        type="button"
        class="site-menu-btn"
        :aria-expanded="menuOpen"
        aria-controls="site-menu"
        @click="menuOpen = !menuOpen"
      >
        <span class="sr-only">{{ menuOpen ? 'Close menu' : 'Open menu' }}</span>
        <span class="site-menu-icon" :class="{ open: menuOpen }" aria-hidden="true" />
      </button>
    </div>
  </header>

  <div id="site-menu" class="site-menu" :hidden="!menuOpen">
    <a v-for="link in links" :key="link.href" :href="link.href" @click="menuOpen = false">
      {{ link.label }}
    </a>
    <NuxtLink v-if="user" to="/dashboard" class="btn-primary" @click="menuOpen = false">
      Open dashboard
    </NuxtLink>
    <template v-else>
      <NuxtLink to="/login" @click="menuOpen = false">Sign in</NuxtLink>
      <NuxtLink to="/signup" class="btn-primary" @click="menuOpen = false">Get started</NuxtLink>
    </template>
  </div>
</template>

<script setup lang="ts">
const user = useSupabaseUser()
const route = useRoute()
const menuOpen = ref(false)

const links = [
  { href: '/#how', label: 'How it works' },
  { href: '/#sandbox', label: 'Schema' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/#pricing', label: 'Pricing' },
]

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  },
)

function onResize() {
  if (window.innerWidth >= 1024) menuOpen.value = false
}

onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))
</script>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  height: 3.5rem;
  padding: 0 max(1rem, env(safe-area-inset-right)) 0 max(1rem, env(safe-area-inset-left));
  border-bottom: 1px solid var(--struct-border);
  background: rgba(15, 17, 21, 0.92);
}

.site-brand {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.site-nav {
  display: none;
  align-items: center;
  gap: 1.25rem;
}

.site-nav a,
.site-signin,
.site-menu a {
  font-size: 0.875rem;
  color: var(--struct-muted);
}

.site-nav a:hover,
.site-signin:hover,
.site-menu a:hover {
  color: var(--struct-text);
}

.site-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.site-signin {
  display: none;
}

.site-menu-btn {
  display: inline-flex;
  width: 2.25rem;
  height: 2.25rem;
  align-items: center;
  justify-content: center;
  border-radius: var(--struct-radius);
  border: 1px solid var(--struct-border);
}

.site-menu-icon,
.site-menu-icon::before,
.site-menu-icon::after {
  display: block;
  width: 0.9rem;
  height: 1px;
  background: var(--struct-text);
  content: '';
}

.site-menu-icon {
  position: relative;
}

.site-menu-icon::before,
.site-menu-icon::after {
  position: absolute;
  left: 0;
}

.site-menu-icon::before {
  top: -5px;
}

.site-menu-icon::after {
  top: 5px;
}

.site-menu-icon.open {
  background: transparent;
}

.site-menu-icon.open::before {
  top: 0;
  transform: rotate(45deg);
}

.site-menu-icon.open::after {
  top: 0;
  transform: rotate(-45deg);
}

.site-menu {
  display: grid;
  gap: 0.75rem;
  border-bottom: 1px solid var(--struct-border);
  padding: 0.85rem 1rem 1rem;
  background: var(--struct-bg);
}

.site-menu[hidden] {
  display: none;
}

@media (min-width: 640px) {
  .site-signin {
    display: inline;
  }
}

@media (min-width: 1024px) {
  .site-nav {
    display: flex;
  }

  .site-menu-btn,
  .site-menu {
    display: none;
  }
}
</style>

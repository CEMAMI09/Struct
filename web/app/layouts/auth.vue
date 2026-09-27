<template>
  <div class="app-shell auth-shell">
    <div class="auth-shell-inner">
      <div class="mb-8 text-center">
        <NuxtLink to="/" class="inline-flex w-full justify-center" aria-label="Struct home">
          <StructLogo variant="dark" size="lg" />
        </NuxtLink>
      </div>
      <slot />
    </div>
  </div>
</template>

<style>
.app-shell.auth-shell {
  display: flex;
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  box-sizing: border-box;
  background: var(--struct-bg);
}

.auth-shell-inner {
  width: 100%;
  max-width: 24rem;
}

.auth-shell-inner .struct-logo {
  width: min(180px, 70vw);
  max-width: 100%;
  height: auto;
}

.auth-field {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--struct-border);
  border-radius: 12px;
  background: transparent;
  color: var(--struct-text);
  font-size: 0.875rem;
  line-height: 1.4;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.auth-field:hover {
  border-color: var(--struct-border-strong);
}

.auth-field:focus {
  border-color: var(--struct-info);
  box-shadow: 0 0 0 3px rgba(86, 23, 252, 0.16);
}
</style>

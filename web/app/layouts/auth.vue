<template>
  <div class="app-shell auth-shell">
    <div class="auth-shell-inner">
      <div class="mb-8 text-center">
        <NuxtLink to="/" class="inline-flex w-full justify-center" aria-label="Struct home">
          <StructLogo lockup />
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
}

.auth-shell-inner {
  width: 100%;
  max-width: 24rem;
}

.auth-field {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 0.65rem 0.75rem;
  border: 1px solid #3d4452;
  border-radius: 8px;
  background: transparent;
  color: #e8eaef;
  font-size: 0.875rem;
  line-height: 1.4;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.auth-field:hover {
  border-color: #5c6578;
}

.auth-field:focus {
  border-color: #38b6ff;
  box-shadow: 0 0 0 3px rgba(56, 182, 255, 0.16);
}
</style>

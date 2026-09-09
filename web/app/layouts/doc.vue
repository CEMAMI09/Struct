<template>
  <div class="doc">
    <header class="doc-nav">
      <NuxtLink to="/" class="doc-logo" aria-label="Struct home">
        <StructLogo size="md" />
      </NuxtLink>
      <NuxtLink to="/" class="btn-ghost text-xs">Back to home</NuxtLink>
    </header>
    <main class="doc-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.doc {
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  min-height: 100vh;
  background: #0f1115;
  color: #e8eaef;
}

.doc-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid #2a2f3a;
  padding: 1rem 1.5rem;
}

.doc-logo {
  display: inline-flex;
  align-items: center;
}

.doc-main {
  max-width: 46rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 5rem;
}

.doc-main :deep(.doc-label) {
  margin: 0 0 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #8b93a7;
}

.doc-main :deep(.doc-title) {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: #f4f5f7;
}

.doc-main :deep(.doc-updated) {
  margin: 0.85rem 0 0;
  font-size: 0.875rem;
  color: #8b93a7;
}

.doc-main :deep(.doc-lede) {
  margin-top: 1rem;
  font-size: 1.125rem;
  line-height: 1.7;
  color: #b4bcc9;
}

.doc-main :deep(section) {
  margin-top: 2.5rem;
  padding-top: 2rem;
  border-top: 1px solid #2a2f3a;
}

.doc-main :deep(h2) {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #f4f5f7;
}

.doc-main :deep(p),
.doc-main :deep(li) {
  margin-top: 0.75rem;
  font-size: 1.0625rem;
  line-height: 1.7;
  color: #b4bcc9;
}

.doc-main :deep(ul) {
  margin: 0.5rem 0 0;
  padding-left: 1.15rem;
}

.doc-main :deep(strong) {
  font-weight: 600;
  color: #e8eaef;
}

.doc-main :deep(a) {
  color: #38b6ff;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.doc-main :deep(.doc-switch) {
  margin-top: 2.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid #2a2f3a;
  font-size: 0.9375rem;
  color: #8b93a7;
}
</style>

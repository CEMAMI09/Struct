<template>
  <div class="site doc">
    <a class="skip-link" href="#main">Skip to content</a>
    <SiteHeader />
    <main id="main" class="doc-main">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.doc-main {
  width: min(100%, 46rem);
  margin: 0 auto;
  padding: 2.5rem 1.25rem 4rem;
}

.doc-main :deep(.doc-label),
.doc-main :deep(.label) {
  margin: 0 0 0.5rem;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--struct-muted);
}

.doc-main :deep(.doc-title),
.doc-main :deep(.method-title) {
  margin: 0;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--struct-text);
}

.doc-main :deep(.doc-updated) {
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
  color: var(--struct-muted);
}

.doc-main :deep(.doc-lede),
.doc-main :deep(.method-lede) {
  margin-top: 0.85rem;
  font-size: 1.05rem;
  line-height: 1.6;
  color: var(--struct-text-secondary);
}

.doc-main :deep(section),
.doc-main :deep(.method-section) {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--struct-border);
}

.doc-main :deep(h2) {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--struct-text);
}

.doc-main :deep(p),
.doc-main :deep(li) {
  margin-top: 0.65rem;
  font-size: 0.975rem;
  line-height: 1.65;
  color: var(--struct-text-secondary);
}

.doc-main :deep(ul) {
  margin: 0.35rem 0 0;
  padding-left: 1.15rem;
}

.doc-main :deep(strong) {
  font-weight: 600;
  color: var(--struct-text);
}

.doc-main :deep(a) {
  color: var(--struct-accent);
  text-underline-offset: 0.15em;
}

.doc-main :deep(.doc-switch) {
  margin-top: 2rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--struct-border);
  font-size: 0.9375rem;
  color: var(--struct-muted);
}
</style>

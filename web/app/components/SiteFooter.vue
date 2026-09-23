<template>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <div>
        <NuxtLink to="/" aria-label="Struct home">
          <StructLogo lockup />
        </NuxtLink>
        <p>Authenticated telemetry for constrained devices.</p>
      </div>
      <div>
        <h2>Product</h2>
        <ul>
          <li><a href="/#how">How it works</a></li>
          <li><a href="/#pricing">Pricing</a></li>
          <li><NuxtLink to="/signup">Get started</NuxtLink></li>
        </ul>
      </div>
      <div>
        <h2>Developers</h2>
        <ul>
          <li><a href="/#sandbox">Schema sandbox</a></li>
          <li><NuxtLink to="/benchmarks">Benchmark methodology</NuxtLink></li>
          <li>
            <a href="https://github.com/CEMAMI09/Struct" target="_blank" rel="noopener noreferrer">GitHub</a>
          </li>
        </ul>
      </div>
      <div>
        <h2>Legal</h2>
        <ul>
          <li><a href="mailto:sales@struct.dev?subject=Struct inquiry">Contact</a></li>
          <li><NuxtLink to="/privacy">Privacy</NuxtLink></li>
          <li><NuxtLink to="/terms">Terms of Use</NuxtLink></li>
        </ul>
      </div>
    </div>
    <div class="site-footer-bottom">
      <p>© {{ year }} Struct</p>
      <NuxtLink to="/login">Sign in</NuxtLink>
    </div>
  </footer>
</template>

<script setup lang="ts">
const year = new Date().getFullYear()
</script>

<style scoped>
.site-footer {
  border-top: 1px solid var(--struct-border);
  padding: 2rem 1.25rem 1.25rem;
}

.site-footer-inner {
  display: grid;
  gap: 1.5rem;
  width: min(100%, var(--struct-content));
  margin: 0 auto;
}

.site-footer p,
.site-footer a {
  color: var(--struct-muted);
  font-size: 0.875rem;
}

.site-footer a:hover {
  color: var(--struct-text);
}

.site-footer h2 {
  margin: 0 0 0.55rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--struct-text-secondary);
}

.site-footer ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-footer li + li {
  margin-top: 0.35rem;
}

.site-footer-bottom {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  width: min(100%, var(--struct-content));
  margin: 1.5rem auto 0;
  padding-top: 1rem;
  border-top: 1px solid var(--struct-border);
}

@media (min-width: 768px) {
  .site-footer-inner {
    grid-template-columns: 1.4fr repeat(3, 1fr);
  }
}
</style>

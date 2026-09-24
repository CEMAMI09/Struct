<template>
  <div class="template-landing bg-black text-white">
    <header class="landing-top">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
        <NuxtLink to="/" class="header-logo" aria-label="Struct home">
          <StructLogo variant="dark" />
        </NuxtLink>
        <nav class="flex items-center gap-3 sm:gap-5" aria-label="Account">
          <NuxtLink v-if="!user" to="/login" class="text-sm text-white/70 transition hover:text-white">
            Sign in
          </NuxtLink>
          <NuxtLink :to="user ? '/dashboard' : '/signup'" class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">
            {{ user ? 'Open dashboard' : 'Sign up' }}
          </NuxtLink>
        </nav>
      </div>
    </header>

    <Teleport to="body">
      <header
        class="landing-float"
        :class="{ 'is-on': isHeaderSticky }"
        :inert="!isHeaderSticky"
      >
        <div class="landing-float-bar">
          <a href="#home" class="float-brand" aria-label="Struct home" @click.prevent="scrollToSection('home')">
            <img src="/struct-icon.svg" alt="" width="40" height="40" />
          </a>
          <nav class="float-links" aria-label="Sections">
            <a
              v-for="link in sectionLinks"
              :key="link.id"
              :href="link.id === 'home' ? '#home' : `#${link.id}`"
              @click.prevent="scrollToSection(link.id)"
            >
              {{ link.label }}
            </a>
          </nav>
          <button
            type="button"
            class="float-toggle"
            :aria-expanded="floatMenuOpen"
            aria-controls="float-menu"
            @click="floatMenuOpen = !floatMenuOpen"
          >
            <span class="sr-only">{{ floatMenuOpen ? 'Close sections' : 'Open sections' }}</span>
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />
            </svg>
          </button>
          <div class="float-actions">
            <NuxtLink v-if="!user" to="/login" class="float-signin">Sign in</NuxtLink>
            <NuxtLink :to="user ? '/dashboard' : '/signup'" class="float-signup">
              {{ user ? 'Dashboard' : 'Sign up' }}
            </NuxtLink>
          </div>
        </div>
        <nav v-if="floatMenuOpen" id="float-menu" class="float-sheet" aria-label="Sections">
          <a
            v-for="link in sectionLinks"
            :key="link.id"
            :href="link.id === 'home' ? '#home' : `#${link.id}`"
            @click.prevent="scrollToSection(link.id)"
          >
            {{ link.label }}
          </a>
        </nav>
      </header>
    </Teleport>

    <main>
      <section class="relative overflow-clip bg-[linear-gradient(to_bottom,#000,#1a0858_34%,#5617fc_65%,#c4b5fd_82%)] pb-[72px] pt-36 sm:pb-24 sm:pt-52">
        <img src="/landing/cursor.png" alt="" width="200" height="200" class="hero-art hero-art-left" />
        <img src="/landing/message.png" alt="" width="200" height="200" class="hero-art hero-art-right" />
        <div class="absolute left-1/2 top-[calc(100%-96px)] h-[375px] w-[750px] -translate-x-1/2 rounded-[100%] border border-[#b79bff] bg-[radial-gradient(closest-side,#000_82%,#5617fc)] sm:top-[calc(100%-120px)] sm:h-[768px] sm:w-[1536px] lg:h-[1200px] lg:w-[2400px]" />
        <div class="relative mx-auto max-w-6xl px-4">
          <div class="flex justify-center">
            <h1 class="mt-8 text-center text-6xl font-bold tracking-tighter md:text-7xl xl:text-8xl">
              From device
              <br />
              to backend
            </h1>
          </div>

          <div class="flex justify-center">
            <p class="mt-8 max-w-md text-center text-xl text-white/80">
              Generate a compact encoder, send authenticated telemetry, and trace delivery to your HTTPS backend.
            </p>
          </div>
          <div class="mt-8 flex justify-center">
            <NuxtLink :to="user ? '/dashboard' : '/signup'" class="rounded-lg bg-white px-5 py-3 font-medium text-black">
              {{ user ? 'Open dashboard' : 'Get started' }}
            </NuxtLink>
          </div>
        </div>
      </section>

      <section class="compat-bleed bg-black py-[72px] sm:py-24" aria-label="Compatible with">
        <h2 class="text-center text-xl text-white/70">Compatible with</h2>
        <div class="ticker">
            <div class="ticker-track">
              <div
                v-for="(logo, index) in tickerLogos"
                :key="`${logo.src}-${index}`"
                class="ticker-item"
                :class="{ 'ticker-item--lg': logo.scale === 'lg' }"
              >
                <img :src="logo.src" :alt="logo.name" class="ticker-logo" width="120" height="40" />
              </div>
            </div>
        </div>
      </section>

      <section id="features" class="bg-black py-[72px] sm:py-24">
        <div class="mx-auto w-full max-w-[1600px] px-6 sm:px-8">
          <h2 class="text-center text-5xl font-bold tracking-tighter sm:text-6xl">Everything you need</h2>
          <div class="mx-auto max-w-xl">
            <p class="mt-5 text-center text-xl text-white/70">
              Define a packed schema, authenticate each frame, store the event, and inspect webhook delivery separately.
            </p>
          </div>
          <div class="need-grid mt-16">
            <article class="need-card need-card--tall">
              <div class="need-stage" aria-hidden="true">
                <p class="viz-label">JSON</p>
                <p class="viz-muted">{"temp":22.5,"humidity":40}</p>
                <p class="viz-label mt-6">Packed fields</p>
                <p class="viz-bytes"><span>00 00 B4 41</span><span>00 00 20 42</span></p>
              </div>
              <div class="need-copy">
                <h3>{{ features[0].title }}</h3>
                <p>{{ features[0].description }}</p>
              </div>
            </article>
            <article class="need-card need-card--split">
              <div class="need-copy">
                <h3>{{ features[1].title }}</h3>
                <p>{{ features[1].description }}</p>
              </div>
              <div class="need-panel" aria-hidden="true">
                <p class="viz-label">Frame</p>
                <p class="viz-bytes"><span>key</span><span>schema</span><span>payload</span><span>HMAC</span></p>
                <p class="viz-ok">Verified before decode</p>
              </div>
            </article>
            <article class="need-card need-card--split">
              <div class="need-copy">
                <h3>{{ features[2].title }}</h3>
                <p>{{ features[2].description }}</p>
              </div>
              <div class="need-panel" aria-hidden="true">
                <p class="viz-row"><span>Stored</span><span class="viz-ok">Committed</span></p>
                <p class="viz-row"><span>Webhook</span><span>Pending</span></p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <LandingSchemaPlayground />

      <section id="product" class="bg-gradient-to-b from-black to-[#3e11b5] pt-[72px] pb-20 sm:pt-24">
        <div class="mx-auto max-w-6xl px-4">
          <h2 class="text-center text-5xl font-bold tracking-tighter sm:text-6xl">Inspect the event</h2>
          <div class="mx-auto max-w-xl">
            <p class="mt-5 text-center text-xl text-white/70">
              A stored event shows decoded fields. Webhook delivery is a separate status: pending, sending, delivered, skipped, or failed.
            </p>
          </div>
        </div>
        <div class="product-stage">
          <img src="/macbookmockup.svg" alt="Struct dashboard on a MacBook" class="product-shot" />
        </div>
      </section>

      <section id="faq" class="bg-gradient-to-b from-[#3e11b5] to-black py-[72px] sm:py-24">
        <div class="mx-auto max-w-6xl px-4">
          <h2 class="mx-auto max-w-[648px] text-center text-5xl font-bold tracking-tighter sm:text-6xl">
            Frequently asked questions
          </h2>
          <div class="mx-auto mt-12 max-w-[648px]">
            <div v-for="(item, index) in faqs" :key="item.question" class="border-b border-white/30 py-7">
              <button
                type="button"
                class="flex w-full items-center gap-4 text-left"
                :aria-expanded="openFaq === index"
                @click="openFaq = openFaq === index ? -1 : index"
              >
                <span class="flex-1 text-lg font-bold">{{ item.question }}</span>
                <svg v-if="openFaq === index" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              <p v-if="openFaq === index" class="mt-4 text-white/70">
                {{ item.answer }}
                <NuxtLink v-if="item.href" :to="item.href" class="ml-1 underline hover:text-white">{{ item.linkLabel }}</NuxtLink>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="relative bg-black py-[72px] text-center sm:py-24">
        <img src="/landing/emojistar.png" alt="" class="cta-art cta-art-left" />
        <img src="/landing/helix2.png" alt="" class="cta-art cta-art-right" />
        <div class="relative mx-auto max-w-xl px-4">
          <h2 class="text-5xl font-bold tracking-tighter sm:text-6xl">Send one event</h2>
          <p class="mt-5 text-lg text-white/70">
            Create a device, generate its encoder, and watch the stored telemetry in the dashboard.
          </p>
          <div class="mt-10 flex justify-center">
            <NuxtLink :to="user ? '/dashboard' : '/signup'" class="rounded-lg bg-white px-5 py-3 font-medium text-black">
              Get started
            </NuxtLink>
          </div>
        </div>
      </section>
    </main>

    <footer class="border-t border-white/20 bg-black py-5 text-white/60">
      <div class="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 sm:flex-row sm:justify-between">
        <p>© {{ year }} Struct</p>
        <ul class="flex items-center gap-4">
          <li><NuxtLink to="/benchmarks" class="hover:text-white">Benchmarks</NuxtLink></li>
          <li><NuxtLink to="/privacy" class="hover:text-white">Privacy</NuxtLink></li>
          <li><NuxtLink to="/terms" class="hover:text-white">Terms</NuxtLink></li>
          <li>
            <a href="https://github.com/CEMAMI09/Struct" class="hover:text-white" target="_blank" rel="noopener noreferrer">GitHub</a>
          </li>
        </ul>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const user = useSupabaseUser()
const openFaq = ref(-1)
const year = new Date().getFullYear()
const isHeaderSticky = ref(false)
const floatMenuOpen = ref(false)
const STICKY_THRESHOLD = 140
let scrollAnim = 0

const sectionLinks = [
  { id: 'home', label: 'Home' },
  { id: 'features', label: 'Features' },
  { id: 'schema', label: 'Schema' },
  { id: 'product', label: 'Product' },
  { id: 'faq', label: 'Questions' },
]

useSeoMeta({
  title: 'Struct — Telemetry for constrained devices',
  description: 'Generate a compact encoder, send authenticated telemetry, and trace delivery to your HTTPS backend.',
})

const compatLogos = [
  { src: '/aws.svg', name: 'AWS', scale: 'lg' },
  { src: '/azure.svg', name: 'Azure' },
  { src: '/cloud.svg', name: 'Google Cloud' },
  { src: '/discord.svg', name: 'Discord', scale: 'lg' },
  { src: '/espressif.svg', name: 'Espressif' },
  { src: '/n.svg', name: 'nRF' },
  { src: '/slack.svg', name: 'Slack' },
  { src: '/snow.svg', name: 'Snowflake' },
  { src: '/spiral.svg', name: 'Spiral' },
  { src: '/st.svg', name: 'STMicroelectronics', scale: 'lg' },
  { src: '/supa.svg', name: 'Supabase' },
  { src: '/zapier.svg', name: 'Zapier' },
]
const tickerLogos = [...compatLogos, ...compatLogos]

const features = [
  {
    kicker: 'Compact encoding',
    title: 'Less overhead. More useful data.',
    description: 'Define packed schemas and generate encoders for supported languages and platforms. Transmit compact binary fields without repeating JSON field names in every payload.',
    visual: 'encoding',
    visualLabel: 'JSON field names compared with packed bytes',
  },
  {
    kicker: 'Authenticated ingestion',
    title: 'Authenticate telemetry before accepting it.',
    description: 'Struct verifies authenticated device frames before decoding and storing telemetry, using established cryptographic primitives and versioned schemas.',
    visual: 'auth',
    visualLabel: 'Authenticated frame parts',
  },
  {
    kicker: 'Delivery you can inspect',
    title: 'Know what happened to your event.',
    description: 'See when Struct stores an event, inspect its decoded fields, and track webhook delivery to your HTTPS backend as a separate operation.',
    visual: 'delivery',
    visualLabel: 'Stored event and webhook status',
  },
]

const faqs = [
  {
    question: 'How does pricing work?',
    answer: 'Free includes five devices and one day of retention. Flexible is $1 per device each month. Pro is $49 per month. Scale is $249 per month.',
    href: '/signup',
    linkLabel: 'Create an account',
  },
  {
    question: 'Does a stored event mean my backend received it?',
    answer: 'No. A stored event means Struct committed it. Webhook delivery is separate and can be pending, sending, delivered, skipped, or failed.',
    href: '/benchmarks',
    linkLabel: 'Read the methodology',
  },
  {
    question: 'Can I change my plan later?',
    answer: 'Yes. Paid plans are managed through Stripe in billing settings after you sign in.',
  },
  {
    question: 'When is Struct the wrong fit?',
    answer: 'When payloads change constantly, the system is mainly request/response, or you need a persistent bidirectional session as the primary transport. Self-serve SAML and compliance certifications are not part of this product.',
  },
]

function updateStickyHeader() {
  const sticky = window.scrollY > STICKY_THRESHOLD
  isHeaderSticky.value = sticky
  if (!sticky) floatMenuOpen.value = false
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
}

function cancelScrollAnim() {
  cancelAnimationFrame(scrollAnim)
  scrollAnim = 0
  window.removeEventListener('wheel', cancelScrollAnim)
  window.removeEventListener('touchstart', cancelScrollAnim)
}

function animateScroll(targetY: number) {
  cancelScrollAnim()
  const startY = window.scrollY
  const distance = targetY - startY
  const duration = 700
  const start = performance.now()
  window.addEventListener('wheel', cancelScrollAnim, { passive: true })
  window.addEventListener('touchstart', cancelScrollAnim, { passive: true })

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    window.scrollTo(0, startY + distance * easeInOut(t))
    if (t < 1) {
      scrollAnim = requestAnimationFrame(step)
      return
    }
    cancelScrollAnim()
  }
  scrollAnim = requestAnimationFrame(step)
}

function scrollToSection(id: string) {
  floatMenuOpen.value = false
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (id === 'home') {
    if (reduce) window.scrollTo(0, 0)
    else animateScroll(0)
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    return
  }
  const el = document.getElementById(id)
  if (!el) return
  if (reduce) {
    el.scrollIntoView()
  } else {
    const top = el.getBoundingClientRect().top + window.scrollY - 88
    animateScroll(Math.max(0, top))
  }
  history.replaceState(null, '', `#${id}`)
}

onMounted(() => {
  updateStickyHeader()
  window.addEventListener('scroll', updateStickyHeader, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', updateStickyHeader)
  cancelScrollAnim()
})

</script>

<style scoped>
.template-landing {
  overflow-x: clip;
  font-family: Figtree, ui-sans-serif, system-ui, sans-serif;
}

.landing-top {
  position: relative;
  z-index: 40;
  width: 100%;
  background: transparent;
}

.header-logo :deep(.struct-logo) {
  position: relative;
  height: 3.5rem;
  width: auto;
  margin: 0;
}

.landing-float {
  position: fixed;
  top: 0.75rem;
  left: 1rem;
  right: 1rem;
  z-index: 50;
  max-width: 900px;
  margin-inline: auto;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 28px;
  background: rgba(11, 14, 20, 0.85);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  color: #fff;
  font-family: Figtree, ui-sans-serif, system-ui, sans-serif;
  backdrop-filter: blur(12px);
  opacity: 0;
  transform: translateY(-12px);
  pointer-events: none;
  transition:
    opacity 300ms ease-out,
    transform 300ms ease-out;
}

.landing-float.is-on {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.landing-float-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.5rem;
  padding: 0.45rem 1.15rem;
}

.float-brand {
  display: inline-flex;
  flex: none;
  align-items: center;
}

.float-brand img {
  display: block;
  height: 2.5rem;
  width: auto;
}

.float-links {
  display: none;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
}

.float-links a,
.float-sheet a {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.875rem;
  transition: color 150ms ease;
}

.float-links a:hover,
.float-sheet a:hover {
  color: #fff;
}

.float-toggle {
  display: inline-flex;
  margin-left: auto;
  height: 2.25rem;
  width: 2.25rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  color: #fff;
}

.float-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 0.65rem;
}

.float-signin {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.875rem;
  transition: color 150ms ease;
}

.float-signin:hover {
  color: #fff;
}

.float-signup {
  border-radius: 999px;
  background: #fff;
  padding: 0.45rem 0.9rem;
  color: #000;
  font-size: 0.875rem;
  font-weight: 500;
}

.float-sheet {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.15rem 0.65rem 0.75rem;
}

.float-sheet a {
  border-radius: 0.6rem;
  padding: 0.55rem 0.35rem;
}

@media (min-width: 768px) {
  .float-links {
    display: flex;
  }

  .float-toggle,
  .float-sheet {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-float {
    transition: none;
  }
}

#features,
#schema,
#product,
#faq {
  scroll-margin-top: 5.5rem;
}

.hero-art {
  position: absolute;
  z-index: 2;
  display: none;
  width: 150px;
  height: auto;
  pointer-events: none;
}

.hero-art-left {
  top: 14rem;
  left: max(1rem, calc(50% - 28rem));
}

.hero-art-right {
  top: 11.5rem;
  right: max(1rem, calc(50% - 28rem));
}

.product-stage {
  display: flex;
  justify-content: center;
  width: min(100% - 2rem, 920px);
  margin: 5rem auto 0;
}

.product-shot {
  display: block;
  width: 100%;
  height: auto;
  margin-inline: auto;
  transform: translateX(1.5rem);
}

.need-grid {
  display: grid;
  gap: 0.75rem;
}

.need-card {
  display: flex;
  min-height: 16rem;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.85rem;
  background: #050505;
}

.need-card--tall .need-stage {
  flex: 1;
  padding: 1.75rem 1.75rem 0;
}

.need-copy {
  padding: 1.35rem 1.5rem 1.5rem;
}

.need-copy h3 {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.03em;
}

.need-copy p {
  margin-top: 0.4rem;
  max-width: 28rem;
  font-size: 0.875rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.62);
}

.need-panel {
  margin: 0 1rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.7rem;
  background: #111;
  padding: 1rem;
}

@media (min-width: 900px) {
  .need-grid {
    grid-template-columns: 0.92fr 1.08fr;
    grid-template-rows: 1fr 1fr;
    min-height: 38rem;
  }

  .need-card--tall {
    grid-row: 1 / span 2;
    min-height: 0;
  }

  .need-card--split {
    display: grid;
    grid-template-columns: 1fr 0.95fr;
    min-height: 0;
    align-items: stretch;
  }

  .need-card--split .need-copy {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .need-card--split .need-panel {
    margin: 1rem 1rem 1rem 0;
    align-self: center;
  }
}

.viz-label,
.viz-muted,
.viz-ok,
.viz-row,
.viz-bytes {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.8125rem;
}

.viz-label {
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.6875rem;
}

.viz-muted {
  margin-top: 0.4rem;
  color: rgba(255, 255, 255, 0.7);
  overflow-wrap: anywhere;
}

.viz-ok {
  margin-top: 1rem;
  color: #b79bff;
}

.viz-bytes,
.viz-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.6rem;
}

.viz-bytes span,
.viz-row {
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0.4rem;
  padding: 0.35rem 0.55rem;
}

.viz-row {
  justify-content: space-between;
  margin-top: 0.75rem;
}

.compat-bleed {
  width: 100vw;
  max-width: 100vw;
  margin-left: calc(50% - 50vw);
}

.ticker {
  position: relative;
  width: 100%;
  margin-top: 2.25rem;
  overflow: hidden;
}

.ticker::before,
.ticker::after {
  position: absolute;
  top: 0;
  z-index: 1;
  height: 100%;
  width: 4.5rem;
  content: '';
  pointer-events: none;
}

.ticker::before {
  left: 0;
  background: linear-gradient(to right, #000 10%, transparent);
}

.ticker::after {
  right: 0;
  background: linear-gradient(to left, #000 10%, transparent);
}

.ticker-track {
  display: flex;
  width: max-content;
  align-items: center;
  gap: 3.5rem;
  animation: ticker 40s linear infinite;
}

.cta-art {
  position: absolute;
  z-index: 1;
  display: none;
  width: 180px;
  height: auto;
  pointer-events: none;
}

.cta-art-left {
  top: 1.5rem;
  left: 2vw;
}

.cta-art-right {
  top: 3rem;
  right: 2vw;
}

@media (min-width: 1100px) {
  .hero-art,
  .cta-art {
    display: block;
  }
}

.ticker-item {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 7.5rem;
  height: 2.75rem;
}

.ticker-item--lg {
  width: 9.25rem;
  height: 3.5rem;
}

.ticker-logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.85;
}

@keyframes ticker {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
</style>

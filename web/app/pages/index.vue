<template>
  <div class="template-landing bg-black text-white">
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
          <NuxtLink v-if="!user" to="/login" @click="floatMenuOpen = false">Sign in</NuxtLink>
          <NuxtLink :to="user ? '/dashboard' : '/signup'" @click="floatMenuOpen = false">
            {{ user ? 'Dashboard' : 'Sign up' }}
          </NuxtLink>
        </nav>
      </header>
    </Teleport>

    <main>
      <div ref="heroStage" class="hero-stage">
        <section id="home" class="hero-pin relative bg-[linear-gradient(to_bottom,#000,#1a0858_34%,#5617fc_65%,#c4b5fd_82%)]">
          <header class="landing-top" :class="{ 'is-gone': isHeaderSticky }">
            <div class="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:py-4">
              <NuxtLink to="/" class="header-logo" aria-label="Struct home">
                <StructLogo variant="dark" />
              </NuxtLink>
              <nav class="flex shrink-0 items-center gap-2 sm:gap-5" aria-label="Account">
                <NuxtLink v-if="!user" to="/login" class="header-signin">
                  Sign in
                </NuxtLink>
                <NuxtLink :to="user ? '/dashboard' : '/signup'" class="header-cta">
                  {{ user ? 'Dashboard' : 'Sign up' }}
                </NuxtLink>
              </nav>
            </div>
          </header>
          <img src="/landing/cursor.png" alt="" width="200" height="200" class="hero-art hero-art-left" />
          <img src="/landing/message.png" alt="" width="200" height="200" class="hero-art hero-art-right" />
          <div class="hero-glow absolute left-1/2 top-[calc(100%-96px)] h-[375px] w-[750px] -translate-x-1/2 rounded-[100%] border border-[#b79bff] bg-[radial-gradient(closest-side,#000_82%,#5617fc)] sm:top-[calc(100%-120px)] sm:h-[768px] sm:w-[1536px] lg:h-[1200px] lg:w-[2400px]" />
          <div class="hero-copy relative mx-auto max-w-6xl px-4">
            <div class="flex justify-center">
              <h1 class="hero-title">
                Less data.
                <br />
                More control.
              </h1>
            </div>

            <div class="flex justify-center">
              <p class="mt-6 max-w-2xl text-center text-base text-white/80 sm:mt-8 sm:text-xl">
                Reduce data usage and transmission costs with compact encoding, secure device communication, and direct delivery to your existing backend.
              </p>
            </div>
            <div class="mt-8 flex justify-center">
              <NuxtLink :to="user ? '/dashboard' : '/signup'" class="rounded-lg bg-white px-5 py-3 font-medium text-black">
                {{ user ? 'Open dashboard' : 'Get started' }}
              </NuxtLink>
            </div>
          </div>
          <div ref="heroFrame" class="hero-frame">
            <img
              src="/landing/dashboard.webp"
              alt="Struct dashboard"
              width="2560"
              height="1434"
              decoding="async"
              fetchpriority="high"
            />
          </div>
        </section>
      </div>

      <section class="compat-bleed bg-black py-[72px] sm:py-24" aria-label="Compatible with">
        <h2 class="text-center text-xl text-white/70">Compatible with</h2>
        <div ref="tickerEl" class="ticker">
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
          <h2 class="section-title text-center">Everything you need</h2>
          <div class="mx-auto max-w-xl">
            <p class="mt-5 text-center text-xl text-white/70">
              Define a packed schema, authenticate each frame, store the event, and inspect webhook delivery separately.
            </p>
          </div>
          <div class="need-flow">
            <HeroDataFlowDiagram />
          </div>
        </div>
      </section>

      <LandingSchemaPlayground />

      <section id="product" class="bg-gradient-to-b from-black to-[#3e11b5] pt-[72px] pb-20 sm:pt-24">
        <div class="mx-auto w-full max-w-[1500px] px-6 sm:px-8">
          <h2 class="section-title text-center">Telemetry you can trust</h2>
          <div class="mx-auto max-w-xl">
            <p class="mt-5 text-center text-xl text-white/70">
              Inspect decoded telemetry, verify device data, and track delivery from one dashboard.
            </p>
          </div>
          <div class="product-scroll">
            <div class="product-pin">
              <div class="product-row">
                <div class="product-copy">
                  <p class="product-kicker">Event visibility</p>
                  <h3 class="mt-3 text-2xl font-semibold tracking-tight sm:text-4xl sm:tracking-tighter">Know exactly what happens to every event.</h3>
                  <p class="mt-4 text-white/70">
                    Struct helps you move beyond raw device data. Inspect decoded fields, verify authenticated ingestion, monitor webhook delivery, and troubleshoot failures across the full path from device to backend.
                  </p>
                  <div class="mt-8 space-y-5">
                    <div>
                      <h4 class="font-semibold">Inspect decoded data</h4>
                      <p class="mt-1 text-sm leading-relaxed text-white/70">View stored events, inspect individual fields, and explore telemetry in real time.</p>
                    </div>
                    <div>
                      <h4 class="font-semibold">Verify trusted ingestion</h4>
                      <p class="mt-1 text-sm leading-relaxed text-white/70">Understand whether a device event was accepted and identify authentication or payload issues early.</p>
                    </div>
                    <div>
                      <h4 class="font-semibold">Track delivery status</h4>
                      <p class="mt-1 text-sm leading-relaxed text-white/70">See whether delivery is pending, sending, delivered, skipped, or failed.</p>
                    </div>
                    <div>
                      <h4 class="font-semibold">Troubleshoot end to end</h4>
                      <p class="mt-1 text-sm leading-relaxed text-white/70">Trace individual events across ingestion, decoding, storage, and delivery from one place.</p>
                    </div>
                  </div>
                </div>
                <div class="product-stage">
                  <EventVisibilityPath />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" class="bg-gradient-to-b from-[#3e11b5] to-black py-[72px] sm:py-24">
        <div class="mx-auto max-w-6xl px-4">
          <h2 class="section-title mx-auto max-w-[648px] text-left">
            FAQs
          </h2>
          <div class="mx-auto mt-12 max-w-[648px]">
            <div v-for="(item, index) in faqs" :key="item.question" class="border-b border-white/30 py-7">
              <button
                type="button"
                class="flex min-h-11 w-full items-center gap-4 text-left"
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
          <h2 class="section-title text-center">Send one event</h2>
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
        <ul class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
import EventVisibilityPath from '~/components/EventVisibilityPath.vue'

definePageMeta({ layout: false })

const user = useSupabaseUser()
const openFaq = ref(-1)
const year = new Date().getFullYear()
const isHeaderSticky = ref(false)
const floatMenuOpen = ref(false)
const heroStage = ref<HTMLElement | null>(null)
const heroFrame = ref<HTMLElement | null>(null)
const tickerEl = ref<HTMLElement | null>(null)
let scrollAnim = 0
let scrollRaf = 0
let reduceMotion = false
let tickerObserver: IntersectionObserver | null = null
const heroMetrics = { top: 0, height: 0, viewH: 0 }

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

function readHeroMetrics() {
  const stage = heroStage.value
  heroMetrics.top = stage?.offsetTop ?? 0
  heroMetrics.height = stage?.offsetHeight ?? window.innerHeight * 2
  heroMetrics.viewH = window.innerHeight
}

function applyScroll() {
  scrollRaf = 0
  const y = window.scrollY
  const { top, height, viewH } = heroMetrics
  const sticky = y > top + height - viewH
  if (isHeaderSticky.value !== sticky) {
    isHeaderSticky.value = sticky
    if (!sticky) floatMenuOpen.value = false
  }
  const frame = heroFrame.value
  if (!frame || reduceMotion) return
  const travel = height - viewH
  const progress = travel <= 0 ? 1 : Math.min(1, Math.max(0, (y - top) / travel))
  frame.style.transform = `translate3d(-50%, ${(1 - progress) * 100}%, 0)`
}

function onScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(applyScroll)
}

function onResize() {
  readHeroMetrics()
  applyScroll()
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
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  readHeroMetrics()
  if (reduceMotion && heroFrame.value) heroFrame.value.style.transform = ''
  else applyScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
  const ticker = tickerEl.value
  if (ticker) {
    tickerObserver = new IntersectionObserver(([entry]) => {
      ticker.classList.toggle('is-live', !!entry?.isIntersecting)
    }, { rootMargin: '180px' })
    tickerObserver.observe(ticker)
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  tickerObserver?.disconnect()
  cancelScrollAnim()
})

</script>

<style scoped>
.template-landing {
  overflow-x: clip;
  font-family: Figtree, ui-sans-serif, system-ui, sans-serif;
}

.landing-top {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 5;
  width: 100%;
  background: transparent;
  opacity: 1;
  transition: opacity 200ms ease 200ms;
}

.landing-top.is-gone {
  opacity: 0;
  pointer-events: none;
  transition-delay: 0ms;
}

.header-logo :deep(.struct-logo) {
  position: relative;
  height: 2.15rem;
  width: auto;
  max-width: 9.5rem;
  margin: 0;
  object-fit: contain;
  object-position: left center;
}

.header-signin {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
}

.header-signin:hover {
  color: #fff;
}

.header-cta {
  border-radius: 0.5rem;
  background: #fff;
  padding: 0.45rem 0.75rem;
  color: #000;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
}

.hero-title,
.section-title {
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 0.95;
  text-wrap: balance;
}

.hero-title {
  text-align: center;
  font-size: clamp(2.35rem, 11vw, 6rem);
}

.section-title {
  font-size: clamp(2.15rem, 8.5vw, 3.75rem);
}

@media (min-width: 640px) {
  .header-logo :deep(.struct-logo) {
    height: 3.5rem;
    max-width: none;
  }

  .header-cta {
    padding: 0.5rem 1rem;
  }
}

.landing-float {
  position: fixed;
  top: max(0.5rem, env(safe-area-inset-top));
  left: max(0.5rem, env(safe-area-inset-left));
  right: max(0.5rem, env(safe-area-inset-right));
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
    opacity 200ms ease,
    transform 200ms ease;
}

.landing-float.is-on {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
  transition-delay: 200ms;
}

.landing-float-bar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 3.25rem;
  padding: 0.35rem 0.55rem 0.35rem 0.7rem;
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
  display: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.875rem;
  white-space: nowrap;
  transition: color 150ms ease;
}

.float-signin:hover {
  color: #fff;
}

.float-signup {
  border-radius: 999px;
  background: #fff;
  padding: 0.45rem 0.75rem;
  color: #000;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
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

@media (min-width: 480px) {
  .float-signin {
    display: inline;
  }

  .landing-float-bar {
    gap: 0.75rem;
    padding: 0.45rem 1.15rem;
  }
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
  .landing-float,
  .landing-top {
    transition: none;
  }

  .hero-stage {
    height: auto;
  }

  .hero-pin {
    position: relative;
    height: auto;
    min-height: 100vh;
    min-height: 100dvh;
    overflow: visible;
    padding-block: 7rem 3rem;
  }

  .hero-frame {
    position: relative;
    bottom: auto;
    left: auto;
    width: min(1280px, calc(100% - 2.5rem));
    margin: 4rem auto 0;
    transform: none;
    padding: 16px;
    border-radius: 24px;
  }

  .hero-frame img {
    border-radius: 14px;
  }
}

#features,
#schema,
#product,
#faq {
  scroll-margin-top: 5.5rem;
}

.hero-stage {
  height: 200vh;
}

.hero-pin {
  position: sticky;
  top: 0;
  display: flex;
  height: 100vh;
  height: 100dvh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.hero-copy {
  position: relative;
  z-index: 2;
}

.hero-glow {
  z-index: 1;
  contain: paint;
  pointer-events: none;
}

.hero-frame {
  position: absolute;
  bottom: 0;
  left: 50%;
  z-index: 4;
  width: min(1280px, calc(100vw - 2.5rem));
  transform: translateX(-50%) translateY(100%);
  overflow: hidden;
  padding: 16px 16px 0;
  border-radius: 24px 24px 0 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.08));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  pointer-events: none;
  contain: layout paint;
  will-change: transform;
}

.hero-frame img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 14px 14px 0 0;
}

.hero-art {
  position: absolute;
  z-index: 3;
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

.product-scroll {
  margin-top: 4.5rem;
}

.product-pin {
  display: block;
}

.product-row {
  display: grid;
  gap: 2.5rem;
  align-items: center;
}

.product-kicker {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #b79bff;
}

.product-copy {
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.85rem;
  background: #050505;
  padding: 1.25rem 1rem;
}

@media (min-width: 640px) {
  .product-copy {
    padding: 1.75rem 1.5rem;
  }
}

.product-stage {
  display: flex;
  justify-content: center;
  min-width: 0;
  min-height: 0;
}

.product-shot {
  display: block;
  width: 100%;
  height: auto;
}

@media (min-width: 900px) {
  .product-scroll {
    height: 580vh;
    margin-top: 5.5rem;
  }

  .product-pin {
    position: sticky;
    top: 0;
    display: flex;
    height: 100vh;
    height: 100dvh;
    align-items: center;
  }

  .product-row {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: 2rem;
    width: 100%;
    height: 100%;
    align-items: center;
  }

  .product-stage {
    align-self: stretch;
    height: 100%;
    overflow: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .product-scroll {
    height: auto;
  }

  .product-pin {
    position: relative;
    display: block;
    height: auto;
  }

  .product-row,
  .product-stage {
    height: auto;
    overflow: visible;
  }
}

.need-flow {
  position: relative;
  height: auto;
  margin-top: 4rem;
}

.need-flow :deep(.hdf) {
  position: relative;
  left: auto;
  top: auto;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  transform: none;
}

@media (min-width: 1024px) {
  .need-flow {
    height: 34rem;
  }

  .need-flow :deep(.hdf) {
    position: absolute;
    left: 50%;
    top: 50%;
    width: min(100%, 72rem);
    transform: translate(-50%, -50%);
  }
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
  animation-play-state: paused;
  will-change: transform;
}

.ticker.is-live .ticker-track {
  animation-play-state: running;
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

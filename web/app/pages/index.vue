<template>
  <div class="template-landing bg-black text-white">
    <header class="bg-black">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <NuxtLink to="/" class="header-logo" aria-label="Struct home">
          <StructLogo size="md" />
        </NuxtLink>

        <button
          type="button"
          class="inline-flex size-10 items-center justify-center rounded-lg border border-white/30 sm:hidden"
          :aria-expanded="menuOpen"
          aria-controls="landing-menu"
          @click="menuOpen = !menuOpen"
        >
          <span class="sr-only">{{ menuOpen ? 'Close menu' : 'Open menu' }}</span>
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />
          </svg>
        </button>

        <nav class="hidden items-center gap-6 sm:flex" aria-label="Primary">
          <a v-for="link in navLinks" :key="link.href" :href="link.href" class="text-white/60 transition hover:text-white">
            {{ link.label }}
          </a>
          <NuxtLink :to="user ? '/dashboard' : '/signup'" class="rounded-lg bg-white px-4 py-2 font-medium text-black">
            {{ user ? 'Open dashboard' : 'Get started' }}
          </NuxtLink>
        </nav>
      </div>
      <div v-if="menuOpen" id="landing-menu" class="border-t border-white/10 px-4 py-3 sm:hidden">
        <a
          v-for="link in navLinks"
          :key="link.href"
          :href="link.href"
          class="block py-2 text-white/80"
          @click="menuOpen = false"
        >
          {{ link.label }}
        </a>
        <NuxtLink :to="user ? '/dashboard' : '/signup'" class="mt-2 inline-flex rounded-lg bg-white px-4 py-2 font-medium text-black" @click="menuOpen = false">
          {{ user ? 'Open dashboard' : 'Get started' }}
        </NuxtLink>
      </div>
    </header>

    <main>
      <section class="relative overflow-clip bg-[linear-gradient(to_bottom,#000,#200d42_34%,#4f21a1_65%,#a46edb_82%)] pb-[72px] pt-36 sm:pb-24 sm:pt-52">
        <img src="/landing/cursor.png" alt="" width="200" height="200" class="hero-art hero-art-left" />
        <img src="/landing/message.png" alt="" width="200" height="200" class="hero-art hero-art-right" />
        <div class="absolute left-1/2 top-[calc(100%-96px)] h-[375px] w-[750px] -translate-x-1/2 rounded-[100%] border border-[#b48cde] bg-[radial-gradient(closest-side,#000_82%,#9560eb)] sm:top-[calc(100%-120px)] sm:h-[768px] sm:w-[1536px] lg:h-[1200px] lg:w-[2400px]" />
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
        <div class="mx-auto max-w-6xl px-4">
          <h2 class="text-center text-5xl font-bold tracking-tighter sm:text-6xl">Everything you need</h2>
          <div class="mx-auto max-w-xl">
            <p class="mt-5 text-center text-xl text-white/70">
              Define a packed schema, authenticate each frame, store the event, and inspect webhook delivery separately.
            </p>
          </div>
          <div class="mt-16 flex flex-col gap-4 sm:flex-row">
            <article
              v-for="feature in features"
              :key="feature.title"
              class="feature-card relative rounded-xl border border-white/30 px-5 py-10 text-center sm:flex-1"
              @mousemove="onFeatureMove"
            >
              <div class="inline-flex size-14 items-center justify-center rounded-lg bg-white text-black">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M17.7672 3.11412C17.7538 2.88477 17.6566 2.66832 17.4942 2.50586C17.3317 2.34341 17.1153 2.24627 16.8859 2.23287C13.7922 2.05084 11.0586 2.41568 8.76093 3.31647C6.56249 4.17818 4.86796 5.51412 3.85858 7.17975C2.48202 9.45397 2.4789 12.2149 3.82343 14.8508L2.46171 16.2126C2.3745 16.2998 2.30533 16.4033 2.25813 16.5172C2.21094 16.6312 2.18665 16.7533 2.18665 16.8766C2.18665 16.9999 2.21094 17.1221 2.25813 17.236C2.30533 17.3499 2.3745 17.4535 2.46171 17.5407C2.63783 17.7168 2.8767 17.8157 3.12577 17.8157C3.2491 17.8157 3.37122 17.7915 3.48516 17.7443C3.5991 17.6971 3.70263 17.6279 3.78983 17.5407L5.15155 16.179C6.45937 16.8462 7.79843 17.1829 9.09296 17.1829C10.4082 17.187 11.699 16.8274 12.8226 16.1438C14.4883 15.1344 15.8242 13.4391 16.6859 11.2415C17.5844 8.94225 17.9492 6.20787 17.7672 3.11412ZM11.8484 14.5376C10.2789 15.4883 8.43749 15.5602 6.5578 14.7657L13.1625 8.161C13.2497 8.07379 13.3189 7.97026 13.3661 7.85632C13.4133 7.74238 13.4376 7.62026 13.4376 7.49693C13.4376 7.37361 13.4133 7.25149 13.3661 7.13755C13.3189 7.02361 13.2497 6.92008 13.1625 6.83287C13.0753 6.74567 12.9718 6.67649 12.8578 6.62929C12.7439 6.5821 12.6218 6.55781 12.4984 6.55781C12.3751 6.55781 12.253 6.5821 12.139 6.62929C12.0251 6.67649 11.9216 6.74567 11.8344 6.83287L5.23437 13.4422C4.44218 11.5672 4.51405 9.72115 5.46874 8.15162C7.10233 5.45396 10.9797 3.95475 15.9375 4.06959C16.0453 9.02584 14.5461 12.904 11.8484 14.5376Z" fill="currentColor" />
                </svg>
              </div>
              <h3 class="mt-6 font-bold">{{ feature.title }}</h3>
              <p class="mt-2 text-white/70">{{ feature.description }}</p>
            </article>
          </div>
        </div>
      </section>

      <section id="product" class="bg-gradient-to-b from-black to-[#5d2cab] py-[72px] sm:py-24">
        <div class="mx-auto max-w-6xl px-4">
          <h2 class="text-center text-5xl font-bold tracking-tighter sm:text-6xl">Inspect the event</h2>
          <div class="mx-auto max-w-xl">
            <p class="mt-5 text-center text-xl text-white/70">
              A stored event shows decoded fields. Webhook delivery is a separate status: pending, sending, delivered, skipped, or failed.
            </p>
          </div>
        </div>
        <div class="product-stage">
          <img src="/landing/app-screen.png" alt="Product preview" class="product-shot" />
        </div>
      </section>

      <section id="faq" class="bg-gradient-to-b from-[#5d2cab] to-black py-[72px] sm:py-24">
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
              <p v-if="openFaq === index" class="mt-4 text-white/70">{{ item.answer }}</p>
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
          <form class="mx-auto mt-10 flex max-w-sm flex-col gap-2.5 sm:flex-row" @submit.prevent="goSignup">
            <label class="sr-only" for="cta-email">Email</label>
            <input
              id="cta-email"
              v-model="email"
              type="email"
              placeholder="your@email.com"
              class="h-12 rounded-lg bg-white/20 px-5 font-medium text-white placeholder:text-[#9ca3af] sm:flex-1"
            />
            <button type="submit" class="h-12 rounded-lg bg-white px-5 font-medium text-black">
              Get access
            </button>
          </form>
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
const menuOpen = ref(false)
const openFaq = ref(-1)
const email = ref('')
const year = new Date().getFullYear()

useSeoMeta({
  title: 'Struct — Telemetry for constrained devices',
  description: 'Generate a compact encoder, send authenticated telemetry, and trace delivery to your HTTPS backend.',
})

const navLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#product', label: 'Product' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/#faq', label: 'Questions' },
  { href: '/login', label: 'Sign in' },
]

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
    mark: '01',
    title: 'Compact encoding',
    description: 'Packed little-endian fields. Generate a C, C++, JavaScript, Python, Rust, or Arduino encoder from the schema.',
  },
  {
    mark: '02',
    title: 'Authenticated ingestion',
    description: 'Every frame carries HMAC-SHA256. The key ID is public. The API secret stays on the device.',
  },
  {
    mark: '03',
    title: 'Delivery you can inspect',
    description: 'A storage receipt means Struct stored the event. Webhook delivery to your HTTPS URL is a separate job.',
  },
]

const faqs = [
  {
    question: 'How does pricing work?',
    answer: 'Free includes up to five devices and one day of retention. Flexible is $1 per device each month. Pro is $49 per month with 150 included devices, encryption, and TCP downlinks. Scale is $249 per month with 1,000 included devices, teams, routing, and audit history.',
  },
  {
    question: 'Does a stored event mean my backend received it?',
    answer: 'No. Confirmed UDP can return a signed storage receipt after the database commit. Webhook jobs are separate and can be pending, sending, delivered, skipped, or failed.',
  },
  {
    question: 'Can I change my plan later?',
    answer: 'Yes. Paid plans are managed through Stripe from the billing settings after you sign in.',
  },
  {
    question: 'When is Struct the wrong fit?',
    answer: 'When payloads change constantly, the system is mainly request/response, or you need a persistent bidirectional session as the primary transport. Self-serve SAML and compliance certifications are not part of this product.',
  },
]

function onFeatureMove(event: MouseEvent) {
  const card = event.currentTarget as HTMLElement
  const rect = card.getBoundingClientRect()
  card.style.setProperty('--x', `${event.clientX - rect.left}px`)
  card.style.setProperty('--y', `${event.clientY - rect.top}px`)
}

function goSignup() {
  if (user.value) {
    navigateTo('/dashboard')
    return
  }
  const query = email.value.trim() ? { email: email.value.trim() } : undefined
  navigateTo({ path: '/signup', query })
}
</script>

<style scoped>
.template-landing {
  overflow-x: clip;
  font-family: Geist, ui-sans-serif, system-ui, sans-serif;
}

.header-logo :deep(.struct-logo) {
  position: relative;
  height: 2.75rem;
  width: auto;
  margin: 0;
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
  width: min(100% - 2rem, 1000px);
  margin: 3rem auto 0;
  perspective: 800px;
}

.product-shot {
  display: block;
  width: 100%;
  height: auto;
  transform: rotateX(14deg);
  transform-origin: center top;
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

.feature-card::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: radial-gradient(100px 100px at var(--x, -100px) var(--y, -100px), #9333ea, transparent 70%);
  content: '';
  pointer-events: none;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

@keyframes ticker {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
</style>

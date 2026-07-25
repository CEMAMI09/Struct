<template>
  <div class="emqx-landing">
    <!-- Announcement -->
    <a href="#platform" class="announce">
      <span>
        Protocol v2: Authenticated packed structs over UDP —
        <em>see the architecture →</em>
      </span>
    </a>

    <!-- Nav -->
    <header class="nav">
      <NuxtLink to="/" class="nav-logo" aria-label="Struct home">
        <StructLogo size="md" />
      </NuxtLink>

      <nav class="nav-links" aria-label="Primary">
        <a href="#platform">Platform</a>
        <a href="#products">Products</a>
        <a href="#use-cases">Use cases</a>
        <a href="#integrations">Integrations</a>
        <a href="#pricing">Pricing</a>
      </nav>

      <div class="nav-actions">
        <template v-if="user">
          <NuxtLink to="/dashboard" class="btn-primary text-xs">Open dashboard</NuxtLink>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="nav-signin">Sign in</NuxtLink>
          <NuxtLink to="/signup" class="btn-primary text-xs">Start Free</NuxtLink>
        </template>
        <button
          type="button"
          class="nav-menu-btn"
          :aria-expanded="menuOpen"
          aria-controls="mobile-menu"
          @click="menuOpen = !menuOpen"
        >
          <span class="sr-only">{{ menuOpen ? 'Close menu' : 'Open menu' }}</span>
          <span class="nav-menu-icon" :class="{ open: menuOpen }" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div
      id="mobile-menu"
      class="mobile-menu"
      :class="{ open: menuOpen }"
      :hidden="!menuOpen"
    >
      <a href="#platform" @click="menuOpen = false">Platform</a>
      <a href="#products" @click="menuOpen = false">Products</a>
      <a href="#use-cases" @click="menuOpen = false">Use cases</a>
      <a href="#integrations" @click="menuOpen = false">Integrations</a>
      <a href="#pricing" @click="menuOpen = false">Pricing</a>
      <NuxtLink to="/signup" class="btn-primary mt-2 w-full" @click="menuOpen = false">
        Start Free
      </NuxtLink>
    </div>

    <!-- Hero -->
    <section class="hero">
      <HeroGradientCanvas />
      <div class="hero-layout">
        <div class="hero-copy">
          <h1 class="hero-title">
            Save Data Costs and Battery Life on
            <span class="hero-rotate" aria-live="polite">
              <span class="hero-rotate-sizer" aria-hidden="true">
                <span v-for="word in heroWords" :key="word">{{ word }}</span>
              </span>
              <Transition name="hero-word" mode="out-in">
                <span
                  :key="heroWordIndex"
                  class="hero-rotate-word"
                >{{ heroWords[heroWordIndex] }}</span>
              </Transition>
            </span>
          </h1>
          <p class="hero-sub">
            Replace verbose JSON with secure packed C++ structs. Keep cellular radios asleep
            longer and stop paying to transmit field names, braces, and quotes.
          </p>
          <div class="hero-ctas">
            <NuxtLink to="/signup" class="btn-primary hero-cta-primary">
              Start Free →
            </NuxtLink>
            <a
              href="mailto:sales@struct.dev?subject=Struct demo request"
              class="btn-ghost hero-cta-secondary"
            >
              Request a Demo →
            </a>
          </div>
        </div>
        <div class="hero-visual">
          <HeroDataFlowDiagram class="hero-shot" />
        </div>
      </div>
    </section>

    <!-- Trust / stats -->
    <section class="stats" aria-label="Platform scale">
      <div class="stats-grid">
        <div v-for="stat in stats" :key="stat.label" class="stat">
          <p class="stat-value">{{ stat.value }}</p>
          <p class="stat-label">{{ stat.label }}</p>
        </div>
      </div>
    </section>

    <!-- Featured story -->
    <section class="feature-story">
      <div class="feature-story-inner">
        <div class="feature-story-copy">
          <p class="eyebrow">Customer story</p>
          <h2 class="section-title">
            How fleets cut cellular spend with packed UDP frames
          </h2>
          <p class="section-body">
            Replace 5&nbsp;KB HTTPS/TLS cold-starts with ~100-byte authenticated UDP datagrams.
            At 10,000 devices pinging once a minute, that is roughly 2.2&nbsp;TB less data —
            about $2,400 saved every month on metered SIMs.
          </p>
          <a href="#bandwidth" class="text-link">Read the economics →</a>
        </div>
        <div class="feature-story-visual" aria-hidden="true">
          <div class="story-metric">
            <span class="story-metric-num">99%</span>
            <span class="story-metric-label">smaller per ping</span>
          </div>
          <div class="story-bars">
            <div class="story-bar">
              <span>HTTPS + TLS</span>
              <i style="width: 100%" />
              <em>~5,200 B</em>
            </div>
            <div class="story-bar story-bar--accent">
              <span>Struct UDP</span>
              <i style="width: 4%" />
              <em>~100 B</em>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Platform / nervous system -->
    <section id="platform" class="platform">
      <div class="section-head">
        <p class="eyebrow">Struct Platform</p>
        <h2 class="section-title">The middleman for the dumb edge</h2>
        <p class="section-body mx-auto max-w-2xl text-center">
          Keep devices deterministic. Fire a single authenticated frame and sleep. Struct
          authenticates, parses with your schema, and routes clean JSON into systems you already
          trust.
        </p>
        <NuxtLink to="/signup" class="text-link mt-4 inline-flex">Explore the platform →</NuxtLink>
      </div>

      <div class="flow" aria-label="Data pipeline">
        <div v-for="(step, i) in pipeline" :key="step" class="flow-step">
          <span class="flow-dot" />
          <span class="flow-label">{{ step }}</span>
          <span v-if="i < pipeline.length - 1" class="flow-line" aria-hidden="true" />
        </div>
      </div>

      <div class="pillars">
        <article v-for="pillar in pillars" :key="pillar.title" class="pillar">
          <h3>{{ pillar.title }}</h3>
          <p>{{ pillar.body }}</p>
        </article>
      </div>
    </section>

    <!-- Products portfolio -->
    <section id="products" class="products">
      <div class="section-head">
        <p class="eyebrow">Portfolio</p>
        <h2 class="section-title">Complete edge-to-cloud telemetry stack</h2>
        <p class="section-body mx-auto max-w-2xl text-center">
          One gateway for ingest, schema versioning, encryption, destinations, and fleet control —
          from the first ESP32 to enterprise scale.
        </p>
      </div>

      <div class="product-grid">
        <a
          v-for="product in products"
          :key="product.title"
          :href="product.href"
          class="product-card"
        >
          <span class="product-badge">{{ product.badge }}</span>
          <h3>{{ product.title }}</h3>
          <p>{{ product.body }}</p>
          <ul>
            <li v-for="item in product.items" :key="item">{{ item }}</li>
          </ul>
        </a>
      </div>
    </section>

    <!-- Use cases -->
    <section id="use-cases" class="use-cases">
      <div class="section-head">
        <p class="eyebrow">Use cases</p>
        <h2 class="section-title">Powering efficient fleets across industries</h2>
        <p class="section-body mx-auto max-w-2xl text-center">
          From asset trackers to ag-tech sensors, Struct is the binary backbone for
          battery-constrained deployments.
        </p>
      </div>

      <div class="use-tabs" role="tablist" aria-label="Use cases">
        <button
          v-for="(uc, i) in useCases"
          :key="uc.tab"
          type="button"
          role="tab"
          class="use-tab"
          :class="{ active: useCaseIndex === i }"
          :aria-selected="useCaseIndex === i"
          @click="useCaseIndex = i"
        >
          {{ uc.tab }}
        </button>
      </div>

      <article class="use-panel" role="tabpanel">
        <div>
          <p class="eyebrow">{{ activeUseCase.tab }}</p>
          <h3 class="use-panel-title">{{ activeUseCase.title }}</h3>
          <p class="section-body">{{ activeUseCase.body }}</p>
          <NuxtLink to="/signup" class="text-link mt-4 inline-flex">Learn more →</NuxtLink>
        </div>
        <div class="use-panel-stats">
          <div v-for="s in activeUseCase.stats" :key="s.label" class="use-stat">
            <strong>{{ s.value }}</strong>
            <span>{{ s.label }}</span>
          </div>
        </div>
      </article>
    </section>

    <!-- Integrations -->
    <section id="integrations" class="integrations">
      <div class="section-head">
        <p class="eyebrow">Cloud integrations</p>
        <h2 class="section-title">Bridge your edge data to any cloud</h2>
        <p class="section-body mx-auto max-w-2xl text-center">
          Route authenticated, schema-parsed JSON to HTTPS destinations — AWS IoT, Datadog,
          Snowflake pipelines, or your own webhooks.
        </p>
      </div>
      <div class="logo-row" aria-label="Integration targets">
        <span v-for="name in integrations" :key="name" class="logo-chip">{{ name }}</span>
      </div>
      <div class="text-center">
        <NuxtLink to="/dashboard/destinations" class="text-link">Explore destinations →</NuxtLink>
      </div>
    </section>

    <!-- Bandwidth proof -->
    <section id="bandwidth" class="bandwidth">
      <div class="bandwidth-inner">
        <div>
          <p class="eyebrow">Fleet economics</p>
          <h2 class="section-title">
            99% smaller per ping.
            <span class="text-[#38B6FF]">~$2,400/mo at fleet scale.</span>
          </h2>
          <p class="section-body mt-5">
            Drop the TLS cold-start. Send a schema-sized UDP frame. Keep radios asleep longer and
            stop paying to transmit field names, braces, and quotes.
          </p>
          <div class="mt-6 flex flex-wrap gap-2">
            <span v-for="chip in signalChips" :key="chip" class="signal-chip">{{ chip }}</span>
          </div>
        </div>
        <div class="bandwidth-card">
          <p class="font-mono text-[10px] uppercase tracking-[0.15em] text-[#8B93A7]">
            10k devices · 1 ping/min
          </p>
          <p class="mt-2 text-4xl font-semibold tracking-[-0.04em] text-[#38B6FF]">~$2,400</p>
          <p class="mt-1 text-xs text-[#8B93A7]">saved per month · ~2.2 TB less data</p>
          <p class="mt-6 text-[10px] leading-relaxed text-[#5A6275]">
            Assumes bypassing a 5&nbsp;KB TLS cold-start per ping on a $1.10/GB metered cellular plan.
          </p>
        </div>
      </div>
    </section>

    <!-- Customer stories -->
    <section class="stories">
      <div class="section-head">
        <p class="eyebrow">Customer stories</p>
        <h2 class="section-title">Shipping efficient fleets with Struct</h2>
        <p class="section-body mx-auto max-w-2xl text-center">
          Hardware teams cut payload size, extend battery life, and keep cloud integrations simple.
        </p>
      </div>

      <div class="story-tabs" role="tablist">
        <button
          v-for="(story, i) in stories"
          :key="story.name"
          type="button"
          role="tab"
          class="story-tab"
          :class="{ active: storyIndex === i }"
          :aria-selected="storyIndex === i"
          :aria-label="`View ${story.name}`"
          @click="storyIndex = i"
        >
          <span class="story-tab-dot" />
        </button>
      </div>

      <article class="story-card">
        <p class="story-industry">{{ activeStory.industry }}</p>
        <h3 class="story-title">{{ activeStory.title }}</h3>
        <blockquote class="story-quote">“{{ activeStory.quote }}”</blockquote>
        <div class="story-metrics">
          <div v-for="m in activeStory.metrics" :key="m.label">
            <strong>{{ m.value }}</strong>
            <span>{{ m.label }}</span>
          </div>
        </div>
      </article>
    </section>

    <!-- Resources -->
    <section class="resources">
      <div class="section-head section-head--row">
        <div>
          <p class="eyebrow">Resources</p>
          <h2 class="section-title">Docs, insights, and releases</h2>
        </div>
        <a
          href="https://github.com/CEMAMI09/Struct#readme"
          class="text-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          View documentation →
        </a>
      </div>
      <div class="resource-grid">
        <a
          v-for="r in resources"
          :key="r.title"
          :href="r.href"
          class="resource-card"
          :target="r.external ? '_blank' : undefined"
          :rel="r.external ? 'noopener noreferrer' : undefined"
        >
          <h3>{{ r.title }}</h3>
          <p>{{ r.body }}</p>
        </a>
      </div>
    </section>

    <!-- Pricing teaser -->
    <section id="pricing" class="pricing">
      <div class="section-head">
        <p class="eyebrow">Pricing</p>
        <h2 class="section-title">Start free. Scale when your fleet does.</h2>
        <p class="section-body mx-auto max-w-2xl text-center">
          Every plan includes the binary telemetry gateway, dashboard, and live debugger.
        </p>
      </div>
      <div class="pricing-grid">
        <article
          v-for="plan in pricingPlans"
          :key="plan.name"
          class="pricing-card"
          :class="{ featured: plan.featured }"
        >
          <span v-if="plan.featured" class="pricing-badge">Most popular</span>
          <p class="pricing-name">{{ plan.name }}</p>
          <div class="pricing-price">
            <span>{{ plan.price }}</span>
            <em v-if="plan.interval">{{ plan.interval }}</em>
          </div>
          <p class="pricing-desc">{{ plan.description }}</p>
          <p class="pricing-devices">{{ plan.devices }}</p>
          <NuxtLink
            :to="plan.to"
            class="mt-auto inline-flex w-full items-center justify-center px-5 py-3 text-xs"
            :class="plan.featured ? 'btn-primary' : 'btn-ghost'"
          >
            {{ plan.cta }}
          </NuxtLink>
        </article>
      </div>
    </section>

    <!-- Final CTA -->
    <section class="final-cta">
      <h2 class="section-title">Ready to cut payload and wake time?</h2>
      <p class="section-body mx-auto max-w-xl text-center">
        Start with five free devices, drop in the ESP32 header Struct generates, and watch live
        telemetry land.
      </p>
      <div class="hero-ctas mt-8">
        <NuxtLink to="/signup" class="btn-primary hero-cta-primary">Start for Free →</NuxtLink>
        <a
          href="mailto:sales@struct.dev?subject=Struct sales"
          class="btn-ghost hero-cta-secondary"
        >
          Contact Sales →
        </a>
      </div>
    </section>

    <!-- FAQ -->
    <section class="faq">
      <div class="section-head">
        <p class="eyebrow">FAQs</p>
        <h2 class="section-title">Quick answers</h2>
        <p class="section-body mx-auto max-w-2xl text-center">
          Common questions about Struct and binary telemetry for constrained fleets.
        </p>
      </div>
      <div class="faq-list">
        <details v-for="item in faqs" :key="item.q" class="faq-item">
          <summary>{{ item.q }}</summary>
          <p>{{ item.a }}</p>
        </details>
      </div>
    </section>

    <!-- Footer -->
    <footer class="footer">
      <div class="footer-inner">
        <div class="footer-grid">
          <div class="footer-brand">
            <NuxtLink to="/" aria-label="Struct home">
              <StructLogo size="md" />
            </NuxtLink>
            <p>Binary telemetry gateway for the edge.</p>
            <a
              href="https://status.struct.dev"
              class="footer-status"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="footer-status-dot" aria-hidden="true" />
              System Status
            </a>
          </div>
          <div>
            <h3>Product</h3>
            <ul>
              <li><a href="#platform">Platform</a></li>
              <li><a href="#products">Products</a></li>
              <li><a href="#pricing">Pricing</a></li>
              <li>
                <a
                  href="https://github.com/CEMAMI09/Struct/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                >Changelog</a>
              </li>
            </ul>
          </div>
          <div>
            <h3>Developers</h3>
            <ul>
              <li>
                <a
                  href="https://github.com/CEMAMI09/Struct#readme"
                  target="_blank"
                  rel="noopener noreferrer"
                >Documentation</a>
              </li>
              <li><NuxtLink to="/dashboard/debugger">Live debugger</NuxtLink></li>
              <li><NuxtLink to="/dashboard/schema">Schema builder</NuxtLink></li>
              <li>
                <a
                  href="https://github.com/CEMAMI09/Struct"
                  target="_blank"
                  rel="noopener noreferrer"
                >GitHub</a>
              </li>
            </ul>
          </div>
          <div>
            <h3>Company</h3>
            <ul>
              <li>
                <a href="mailto:sales@struct.dev?subject=Struct inquiry">Contact</a>
              </li>
              <li><NuxtLink to="/privacy">Privacy</NuxtLink></li>
              <li><NuxtLink to="/terms">Terms</NuxtLink></li>
              <li><NuxtLink to="/login">Sign in</NuxtLink></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <p>© {{ new Date().getFullYear() }} Struct. All rights reserved.</p>
          <p class="footer-note">Layout modeled after EMQX for design testing · /test</p>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const user = useSupabaseUser()
const menuOpen = ref(false)
const useCaseIndex = ref(0)
const storyIndex = ref(0)
const prefersReducedMotion = ref(false)

const heroWords = [
  'Remote Sensors',
  'Asset Trackers',
  'Field Robotics',
  'Ag-Tech Devices',
  'Microcontrollers',
]
const heroWordIndex = ref(0)
const HERO_HOLD_MS = 3400
const HERO_FADE_MS = 380
let heroCarouselStopped = false
let heroWordTimer: ReturnType<typeof setTimeout> | null = null

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    heroWordTimer = setTimeout(resolve, ms)
  })
}

async function runHeroCarousel() {
  while (!heroCarouselStopped) {
    await delay(HERO_HOLD_MS)
    if (heroCarouselStopped) break
    heroWordIndex.value = (heroWordIndex.value + 1) % heroWords.length
    await delay(HERO_FADE_MS * 2)
  }
}

useSeoMeta({
  title: 'Struct — Binary Telemetry Gateway (Test Landing)',
  description:
    'Connect, authenticate, and stream packed C++ structs from battery-constrained fleets to any cloud.',
  robots: 'noindex, nofollow',
})

const stats = [
  { value: '500+', label: 'Hardware Engineers' },
  { value: '50,000+', label: 'Active Edge Devices' },
  { value: '11+ TB', label: 'Cellular Data Saved Monthly' },
  { value: '99%', label: 'Smaller Than HTTPS+TLS' },
]

const pipeline = ['Connect', 'Authenticate', 'Parse', 'Route', 'Store']

const pillars = [
  {
    title: 'Efficient',
    body: 'Schema-sized UDP frames with per-packet HMAC. Radios wake, transmit, and sleep in milliseconds — no handshake tax.',
  },
  {
    title: 'Unified',
    body: 'Ingest, schema versions, encryption, destinations, debugger, and downlinks in one gateway and dashboard.',
  },
  {
    title: 'Secure',
    body: 'HMAC auth, optional ChaCha20-Poly1305, org isolation with RLS, and immutable audit logs on Scale.',
  },
]

const products = [
  {
    title: 'Struct Cloud',
    badge: 'Managed',
    body: 'Fully managed binary gateway with live dashboard and destinations.',
    items: ['5 free devices', 'Realtime telemetry', 'HTTPS webhooks'],
    href: '/signup',
  },
  {
    title: 'Struct Pro',
    badge: 'Growing fleets',
    body: 'Encryption and device control for production edge fleets.',
    items: ['ChaCha20', 'Downlinks', '150 devices included'],
    href: '/signup',
  },
  {
    title: 'Struct Scale',
    badge: 'Teams',
    body: 'Governance and advanced routing for large organizations.',
    items: ['Team RBAC', 'Audit logs', '1,000 devices included'],
    href: '/signup',
  },
  {
    title: 'Struct Enterprise',
    badge: 'Custom',
    body: 'Dedicated ingest and commercial terms for demanding fleets.',
    items: ['SAML SSO', 'Dedicated ports', 'Custom SLAs'],
    href: 'mailto:sales@struct.dev?subject=Struct Enterprise',
  },
]

const useCases = [
  {
    tab: 'Asset Tracking',
    title: 'Telematics without the JSON tax',
    body: 'Trackers on LTE-M and NB-IoT send fixed structs instead of verbose MQTT payloads, extending field battery life from months to years.',
    stats: [
      { value: '10×', label: 'Less CPU awake time' },
      { value: 'UDP', label: 'Battery path' },
    ],
  },
  {
    tab: 'Ag-Tech',
    title: 'Soil and climate sensors at scale',
    body: 'Remote sensors publish typed fields over authenticated frames. Struct versions schemas so old firmware keeps working after you add columns.',
    stats: [
      { value: 'vN', label: 'Immutable schemas' },
      { value: '5 free', label: 'Devices to start' },
    ],
  },
  {
    tab: 'Field Robotics',
    title: 'Deterministic uplinks for mobile robots',
    body: 'Skip heap-fragmenting serializers. Pack floats and flags on-device, then route clean JSON into your fleet cloud.',
    stats: [
      { value: '0', label: 'Heap JSON risk' },
      { value: 'TCP/UDP', label: 'Dual ingest' },
    ],
  },
  {
    tab: 'Smart Hardware',
    title: 'Consumer and industrial MCUs',
    body: 'ESP32 fleets get a generated C++ header from your schema. Debug wire frames in the browser before you flash firmware.',
    stats: [
      { value: 'C++', label: 'Header export' },
      { value: 'Live', label: 'Frame debugger' },
    ],
  },
  {
    tab: 'Energy',
    title: 'Meters and DER edge nodes',
    body: 'Metered SIMs and satellite links punish chatty protocols. Struct keeps each reading tiny and authenticated.',
    stats: [
      { value: '~100 B', label: 'Typical frame' },
      { value: 'HMAC', label: 'Per packet' },
    ],
  },
]

const activeUseCase = computed(() => useCases[useCaseIndex.value]!)

const integrations = [
  'AWS IoT',
  'Datadog',
  'Snowflake',
  'Azure',
  'GCP',
  'Custom Webhooks',
  'Supabase',
  'Grafana',
]

const signalChips = ['LTE-M', 'NB-IoT', 'Satellite', 'Metered SIMs']

const stories = [
  {
    name: 'Cellular fleet',
    industry: 'Asset Tracking',
    title: 'Cutting SIM spend with UDP frames',
    quote:
      'We stopped paying to ship field names over the air. Packed structs plus Struct destinations got us into Datadog without a second control plane.',
    metrics: [
      { value: '99%', label: 'Smaller pings' },
      { value: '~$2.4k', label: 'Saved / mo @ 10k' },
    ],
  },
  {
    name: 'Ag sensors',
    industry: 'Ag-Tech',
    title: 'Schema versions that survive OTA lag',
    quote:
      'Firmware in the field stays on schema v2 while we publish v3. Struct parses both and the dashboard just works.',
    metrics: [
      { value: 'Immutable', label: 'Schema history' },
      { value: 'ESP32', label: 'Header export' },
    ],
  },
  {
    name: 'Pro ops',
    industry: 'Industrial IoT',
    title: 'Encryption without TLS on the MCU',
    quote:
      'ChaCha20-Poly1305 on Pro gave us confidentiality without burning the radio on handshakes every wake.',
    metrics: [
      { value: 'AEAD', label: 'On payload' },
      { value: 'Nonce', label: 'Replay reject' },
    ],
  },
]

const activeStory = computed(() => stories[storyIndex.value]!)

const resources = [
  {
    title: 'Protocol & architecture',
    body: 'How Protocol v2 frames, HMAC, schema bytes, and optional encryption fit together.',
    href: 'https://github.com/CEMAMI09/Struct#readme',
    external: true,
  },
  {
    title: 'Live debugger',
    body: 'Build a test frame from your schema and inspect raw hex beside parsed JSON.',
    href: '/dashboard/debugger',
    external: false,
  },
  {
    title: 'Schema builder',
    body: 'Define fields, see byte size, generate C++, and publish immutable versions.',
    href: '/dashboard/schema',
    external: false,
  },
  {
    title: 'Changelog',
    body: 'Release notes for gateway, dashboard, and protocol updates.',
    href: 'https://github.com/CEMAMI09/Struct/releases',
    external: true,
  },
]

const pricingPlans = [
  {
    name: 'Developer',
    price: '$0',
    interval: 'forever',
    description: 'Build and validate your first edge fleet.',
    devices: 'Up to 5 devices',
    cta: 'Start free',
    to: '/signup',
    featured: false,
  },
  {
    name: 'Pro',
    price: '$49',
    interval: '/ month',
    description: 'Encryption and downlinks for growing fleets.',
    devices: 'Includes 150 devices',
    cta: 'Choose Pro',
    to: '/signup',
    featured: true,
  },
  {
    name: 'Scale',
    price: '$249',
    interval: '/ month',
    description: 'RBAC, audit logs, and advanced routing.',
    devices: 'Includes 1,000 devices',
    cta: 'Choose Scale',
    to: '/signup',
    featured: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    interval: '',
    description: 'Dedicated ingest and commercial terms.',
    devices: 'Custom allowance',
    cta: 'Contact sales',
    to: 'mailto:sales@struct.dev?subject=Struct Enterprise',
    featured: false,
  },
]

const faqs = [
  {
    q: 'What is Struct?',
    a: 'Struct is an ultra-lightweight IoT gateway. Devices send packed C/C++ structs over TCP or UDP; the gateway authenticates each frame, resolves the schema, optionally decrypts, stores telemetry, and routes clean JSON downstream.',
  },
  {
    q: 'How do I get started?',
    a: 'Create a free account, add a device, define a schema, download the generated ESP32/C++ header, and send your first authenticated frame. The first five devices are free.',
  },
  {
    q: 'UDP or TCP?',
    a: 'UDP is the battery path: one datagram, no handshake tax. TCP is available when you need a streamed connection. Both use Protocol v2 with HMAC authentication.',
  },
  {
    q: 'How does security work?',
    a: 'Every frame is authenticated with HMAC-SHA256. Device API keys never cross the wire in plaintext. Pro and Scale can enable ChaCha20-Poly1305 payload encryption with nonce and timestamp replay protection.',
  },
  {
    q: 'What about schema changes?',
    a: 'Publishing a schema creates a new immutable version. Old firmware can keep sending its original version byte while new devices use the latest layout.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — the Developer plan includes five devices forever, with dashboard, basic webhooks, and the live debugger.',
  },
]

function onResize() {
  if (window.innerWidth >= 1024) menuOpen.value = false
}

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.addEventListener('resize', onResize)
  if (!prefersReducedMotion.value) {
    runHeroCarousel()
  }
})

onBeforeUnmount(() => {
  heroCarouselStopped = true
  window.removeEventListener('resize', onResize)
  if (heroWordTimer) clearTimeout(heroWordTimer)
})
</script>

<style scoped>
.emqx-landing {
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  background: #0f1115;
  color: #e8eaef;
  min-height: 100vh;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Announcement — Struct blue gradient (not purple) */
.announce {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.65rem 1rem;
  background: linear-gradient(90deg, #0a4a6e 0%, #1a6fa0 45%, #38b6ff 100%);
  font-size: 0.8125rem;
  font-weight: 500;
  color: #fff;
  text-align: center;
  transition: filter 0.15s ease;
}

.announce:hover {
  filter: brightness(1.06);
}

.announce em {
  font-style: normal;
  font-weight: 600;
}

/* Nav */
.nav {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  height: 4.25rem;
  padding: 0 1.25rem;
  border-bottom: 1px solid #2a2f3a;
  background: rgba(15, 17, 21, 0.88);
  backdrop-filter: blur(16px);
}

@media (min-width: 1024px) {
  .nav {
    padding: 0 2.5rem;
  }
}

.nav-logo :deep(.struct-logo) {
  margin-inline: 0;
  height: 2.25rem;
}

.nav-links {
  display: none;
  align-items: center;
  gap: 1.75rem;
}

@media (min-width: 1024px) {
  .nav-links {
    display: flex;
  }
}

.nav-links a {
  font-size: 0.875rem;
  color: #a8b2c4;
  transition: color 0.15s ease;
}

.nav-links a:hover {
  color: #38b6ff;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.nav-signin {
  display: none;
  font-size: 0.8125rem;
  color: #a8b2c4;
}

@media (min-width: 640px) {
  .nav-signin {
    display: inline;
  }
}

.nav-signin:hover {
  color: #38b6ff;
}

.nav-menu-btn {
  display: flex;
  width: 2.25rem;
  height: 2.25rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  border: 1px solid #2a2f3a;
  background: transparent;
}

@media (min-width: 1024px) {
  .nav-menu-btn {
    display: none;
  }
}

.nav-menu-icon,
.nav-menu-icon::before,
.nav-menu-icon::after {
  display: block;
  width: 1rem;
  height: 1.5px;
  background: #e8eaef;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.nav-menu-icon {
  position: relative;
}

.nav-menu-icon::before,
.nav-menu-icon::after {
  content: '';
  position: absolute;
  left: 0;
}

.nav-menu-icon::before {
  top: -5px;
}

.nav-menu-icon::after {
  top: 5px;
}

.nav-menu-icon.open {
  background: transparent;
}

.nav-menu-icon.open::before {
  top: 0;
  transform: rotate(45deg);
}

.nav-menu-icon.open::after {
  top: 0;
  transform: rotate(-45deg);
}

.mobile-menu {
  display: none;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 1.25rem 1.25rem;
  border-bottom: 1px solid #2a2f3a;
  background: #15181e;
}

.mobile-menu.open {
  display: flex;
}

@media (min-width: 1024px) {
  .mobile-menu,
  .mobile-menu.open {
    display: none;
  }
}

.mobile-menu a {
  padding: 0.75rem 0.5rem;
  font-size: 0.9375rem;
  color: #e8eaef;
  border-radius: 0.5rem;
}

.mobile-menu a:hover {
  background: rgba(56, 182, 255, 0.08);
  color: #38b6ff;
}

/* Hero — left copy + diagram */
.hero {
  position: relative;
  overflow: hidden;
  padding: 4.5rem 0 5rem;
}

@media (min-width: 640px) {
  .hero {
    padding: 6rem 0 6.5rem;
  }
}

@media (min-width: 1024px) {
  .hero {
    padding: 7rem 0 8rem;
  }
}

.hero-layout {
  position: relative;
  z-index: 1;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2.5rem;
  align-items: center;
  padding-left: 1.25rem;
  padding-right: 1.25rem;
}

@media (min-width: 1024px) {
  .hero-layout {
    grid-template-columns: minmax(0, 32rem) minmax(0, 1fr);
    gap: 1rem;
    max-width: none;
    padding-left: max(1.5rem, calc((100vw - 72rem) / 2 - 3rem));
    padding-right: 0;
    transform: translateX(0.5rem);
  }
}

.hero-copy {
  text-align: left;
  animation: rise 0.75s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@media (min-width: 1024px) {
  .hero-copy {
    margin-left: -1rem;
  }
}

.hero-title {
  margin: 0;
  max-width: 32rem;
  font-size: clamp(1.85rem, 4.2vw, 3.15rem);
  font-weight: 650;
  line-height: 1.1;
  letter-spacing: -0.035em;
  color: #f4f5f7;
}

.hero-rotate {
  display: block;
  margin-top: 0.12em;
  text-align: left;
  position: relative;
}

.hero-rotate-sizer {
  display: grid;
  visibility: hidden;
  pointer-events: none;
}

.hero-rotate-sizer > span {
  grid-area: 1 / 1;
}

.hero-rotate-word {
  position: absolute;
  inset: 0;
  display: block;
  color: #38b6ff;
}

.hero-word-enter-active,
.hero-word-leave-active {
  transition:
    opacity 0.38s ease,
    transform 0.38s ease;
}

.hero-word-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.hero-word-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.hero-sub {
  margin: 1.25rem 0 0;
  max-width: 28rem;
  font-size: 1.0625rem;
  line-height: 1.65;
  color: #8b93a7;
}

.hero-ctas {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.75rem;
  margin-top: 1.75rem;
}

@media (min-width: 480px) {
  .hero-ctas {
    flex-direction: row;
    align-items: center;
  }
}

.hero-cta-primary,
.hero-cta-secondary {
  padding: 0.85rem 1.5rem;
  font-size: 0.9375rem;
  border-radius: 0.65rem;
}

.hero-visual {
  position: relative;
  width: 100%;
  min-height: 200px;
}

@media (min-width: 1024px) {
  .hero-visual {
    min-height: 480px;
    height: 100%;
    width: calc(100% + 2rem);
    max-width: none;
  }
}

.hero-shot {
  display: block;
  width: 100%;
  height: auto;
  max-height: none;
  margin-inline: auto;
  animation: hero-in 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@media (min-width: 1024px) {
  .hero-shot {
    position: absolute;
    left: 0;
    top: 50%;
    width: min(118%, 54rem);
    max-width: none;
    max-height: none;
    height: auto;
    margin: 0;
    transform: translate(-1.5rem, -50%) scale(0.95);
    transform-origin: left center;
    animation-name: hero-in-lg;
  }
}

@keyframes hero-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes hero-in-lg {
  from {
    opacity: 0;
    transform: translate(-1.5rem, calc(-50% + 20px)) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translate(-1.5rem, -50%) scale(0.95);
  }
}

/* Stats */
.stats {
  border-top: 1px solid #2a2f3a;
  border-bottom: 1px solid #2a2f3a;
  background: #15181e;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
  max-width: 72rem;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

@media (min-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(4, 1fr);
    padding: 2.25rem 1.5rem;
  }
}

.stat {
  text-align: center;
}

.stat-value {
  margin: 0;
  font-size: clamp(1.5rem, 3vw, 2.15rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  color: #38b6ff;
}

.stat-label {
  margin: 0.4rem 0 0;
  font-size: 0.8125rem;
  color: #8b93a7;
}

/* Shared section bits */
.eyebrow {
  margin: 0 0 0.75rem;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #38b6ff;
}

.section-title {
  margin: 0;
  font-size: clamp(1.65rem, 3.5vw, 2.5rem);
  font-weight: 650;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: #f4f5f7;
}

.section-body {
  margin: 0;
  font-size: 1rem;
  line-height: 1.65;
  color: #8b93a7;
}

.section-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 2.5rem;
  gap: 0.75rem;
}

.section-head--row {
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

@media (min-width: 768px) {
  .section-head--row {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
  }
}

.text-link {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #38b6ff;
  transition: opacity 0.15s ease;
}

.text-link:hover {
  opacity: 0.85;
}

/* Feature story */
.feature-story {
  padding: 4.5rem 1.25rem;
}

.feature-story-inner {
  display: grid;
  gap: 2.5rem;
  max-width: 72rem;
  margin: 0 auto;
  align-items: center;
}

@media (min-width: 900px) {
  .feature-story-inner {
    grid-template-columns: 1.1fr 0.9fr;
    gap: 3.5rem;
  }
}

.feature-story-copy .section-body {
  margin-top: 1rem;
  max-width: 32rem;
}

.feature-story-copy .text-link {
  display: inline-flex;
  margin-top: 1.25rem;
}

.feature-story-visual {
  border: 1px solid #2a2f3a;
  border-radius: 1rem;
  padding: 1.75rem;
  background:
    radial-gradient(circle at 90% 10%, rgba(56, 182, 255, 0.12), transparent 40%),
    #1a1d24;
}

.story-metric {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 1.75rem;
}

.story-metric-num {
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: #38b6ff;
}

.story-metric-label {
  font-size: 0.875rem;
  color: #8b93a7;
}

.story-bars {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.story-bar span {
  display: block;
  margin-bottom: 0.4rem;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8b93a7;
}

.story-bar i {
  display: block;
  height: 8px;
  border-radius: 999px;
  background: #596174;
}

.story-bar--accent i {
  background: #38b6ff;
  box-shadow: 0 0 14px rgba(56, 182, 255, 0.45);
  min-width: 8px;
}

.story-bar em {
  display: block;
  margin-top: 0.35rem;
  font-style: normal;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: #a8b2c4;
}

.story-bar--accent em {
  color: #38b6ff;
}

/* Platform */
.platform {
  padding: 4.5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
  background: #12151a;
}

.flow {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem 0;
  max-width: 48rem;
  margin: 0 auto 3rem;
}

.flow-step {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 5.5rem;
}

.flow-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #38b6ff;
  box-shadow: 0 0 0 4px rgba(56, 182, 255, 0.15);
}

.flow-label {
  margin-top: 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #e8eaef;
}

.flow-line {
  display: none;
}

@media (min-width: 640px) {
  .flow-step {
    width: 6.5rem;
  }

  .flow-line {
    display: block;
    position: absolute;
    top: 4px;
    left: calc(50% + 12px);
    width: calc(100% - 8px);
    height: 1px;
    background: linear-gradient(90deg, #38b6ff, #2a2f3a);
  }
}

.pillars {
  display: grid;
  gap: 1rem;
  max-width: 72rem;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .pillars {
    grid-template-columns: repeat(3, 1fr);
  }
}

.pillar {
  border: 1px solid #2a2f3a;
  border-radius: 1rem;
  padding: 1.5rem;
  background: #1a1d24;
}

.pillar h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 650;
  color: #f4f5f7;
}

.pillar p {
  margin: 0.75rem 0 0;
  font-size: 0.9rem;
  line-height: 1.6;
  color: #8b93a7;
}

/* Products */
.products {
  padding: 4.5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
}

.product-grid {
  display: grid;
  gap: 1rem;
  max-width: 72rem;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .product-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1100px) {
  .product-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.product-card {
  display: flex;
  flex-direction: column;
  border: 1px solid #2a2f3a;
  border-radius: 1rem;
  padding: 1.5rem;
  background: #1a1d24;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.product-card:hover {
  border-color: rgba(56, 182, 255, 0.45);
  transform: translateY(-2px);
}

.product-badge {
  align-self: flex-start;
  margin-bottom: 1rem;
  border: 1px solid rgba(56, 182, 255, 0.3);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #38b6ff;
}

.product-card h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 650;
  color: #f4f5f7;
}

.product-card > p {
  margin: 0.65rem 0 0;
  font-size: 0.875rem;
  line-height: 1.55;
  color: #8b93a7;
  flex: 1;
}

.product-card ul {
  list-style: none;
  margin: 1.25rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.product-card li {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: #a8b2c4;
}

.product-card li::before {
  content: '✓ ';
  color: #38b6ff;
}

/* Use cases */
.use-cases {
  padding: 4.5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
  background: #12151a;
}

.use-tabs {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  max-width: 72rem;
  margin: 0 auto 1.5rem;
}

.use-tab {
  border: 1px solid #2a2f3a;
  border-radius: 999px;
  background: transparent;
  padding: 0.5rem 0.95rem;
  font-size: 0.8125rem;
  color: #8b93a7;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background 0.15s ease;
}

.use-tab:hover {
  color: #e8eaef;
  border-color: #3a4150;
}

.use-tab.active {
  border-color: rgba(56, 182, 255, 0.5);
  background: rgba(56, 182, 255, 0.1);
  color: #38b6ff;
}

.use-panel {
  display: grid;
  gap: 2rem;
  max-width: 72rem;
  margin: 0 auto;
  border: 1px solid #2a2f3a;
  border-radius: 1.15rem;
  padding: 1.75rem;
  background: #1a1d24;
}

@media (min-width: 800px) {
  .use-panel {
    grid-template-columns: 1.4fr 0.8fr;
    padding: 2.25rem;
    align-items: center;
  }
}

.use-panel-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: #f4f5f7;
}

.use-panel .section-body {
  margin-top: 0.85rem;
}

.use-panel-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.use-stat {
  border: 1px solid #2a2f3a;
  border-radius: 0.75rem;
  padding: 1rem;
  background: #0f1115;
  text-align: center;
}

.use-stat strong {
  display: block;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #38b6ff;
}

.use-stat span {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  color: #8b93a7;
}

/* Integrations */
.integrations {
  padding: 4.5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
}

.logo-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.65rem;
  max-width: 56rem;
  margin: 0 auto 1.75rem;
}

.logo-chip {
  border: 1px solid #2a2f3a;
  border-radius: 0.65rem;
  padding: 0.7rem 1.1rem;
  background: #1a1d24;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #a8b2c4;
}

/* Bandwidth */
.bandwidth {
  padding: 1.25rem;
  border-top: 1px solid #2a2f3a;
}

.bandwidth-inner {
  display: grid;
  gap: 2rem;
  max-width: 72rem;
  margin: 0 auto;
  border: 1px solid #2a2f3a;
  border-radius: 1.25rem;
  padding: clamp(1.5rem, 4vw, 3rem);
  background:
    radial-gradient(circle at 85% 15%, rgba(56, 182, 255, 0.1), transparent 32%),
    #15181e;
}

@media (min-width: 900px) {
  .bandwidth-inner {
    grid-template-columns: 1.2fr 0.8fr;
    align-items: center;
  }
}

.signal-chip {
  border: 1px solid #2a2f3a;
  border-radius: 999px;
  padding: 0.4rem 0.7rem;
  background: rgba(15, 17, 21, 0.7);
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.5625rem;
  letter-spacing: 0.08em;
  color: #8b93a7;
}

.bandwidth-card {
  border: 1px solid rgba(56, 182, 255, 0.22);
  border-radius: 1rem;
  padding: 1.5rem;
  background: rgba(15, 17, 21, 0.85);
}

/* Stories */
.stories {
  padding: 4.5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
  background: #12151a;
}

.story-tabs {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.story-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.story-tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #3a4150;
  transition:
    background 0.15s ease,
    transform 0.15s ease;
}

.story-tab.active .story-tab-dot {
  background: #38b6ff;
  transform: scale(1.25);
}

.story-card {
  max-width: 48rem;
  margin: 0 auto;
  border: 1px solid #2a2f3a;
  border-radius: 1.15rem;
  padding: 2rem;
  background: #1a1d24;
  text-align: center;
}

.story-industry {
  margin: 0;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #38b6ff;
}

.story-title {
  margin: 0.75rem 0 0;
  font-size: 1.35rem;
  font-weight: 650;
  color: #f4f5f7;
}

.story-quote {
  margin: 1.25rem 0 0;
  font-size: 1.05rem;
  line-height: 1.65;
  color: #a8b2c4;
}

.story-metrics {
  display: flex;
  justify-content: center;
  gap: 2.5rem;
  margin-top: 1.75rem;
  padding-top: 1.5rem;
  border-top: 1px solid #2a2f3a;
}

.story-metrics strong {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  color: #38b6ff;
}

.story-metrics span {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: #8b93a7;
}

/* Resources */
.resources {
  padding: 4.5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
}

.resources .section-head {
  max-width: 72rem;
  margin-inline: auto;
  margin-bottom: 2rem;
}

.resource-grid {
  display: grid;
  gap: 1rem;
  max-width: 72rem;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .resource-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1100px) {
  .resource-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.resource-card {
  border: 1px solid #2a2f3a;
  border-radius: 1rem;
  padding: 1.35rem;
  background: #1a1d24;
  transition: border-color 0.15s ease;
}

.resource-card:hover {
  border-color: rgba(56, 182, 255, 0.4);
}

.resource-card h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  color: #f4f5f7;
}

.resource-card p {
  margin: 0.65rem 0 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: #8b93a7;
}

/* Pricing */
.pricing {
  padding: 4.5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
  background: #12151a;
}

.pricing-grid {
  display: grid;
  gap: 1rem;
  max-width: 72rem;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .pricing-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1100px) {
  .pricing-grid {
    grid-template-columns: repeat(4, 1fr);
    align-items: stretch;
  }
}

.pricing-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid #2a2f3a;
  border-radius: 1rem;
  padding: 1.75rem 1.5rem;
  background: #1a1d24;
}

.pricing-card.featured {
  border-color: rgba(56, 182, 255, 0.55);
  background: linear-gradient(165deg, rgba(56, 182, 255, 0.09), #1a1d24 48%);
  box-shadow: 0 28px 55px -32px rgba(56, 182, 255, 0.5);
}

.pricing-badge {
  position: absolute;
  top: 0;
  right: 1rem;
  transform: translateY(-50%);
  border: 1px solid rgba(56, 182, 255, 0.5);
  border-radius: 999px;
  background: #101b24;
  padding: 0.25rem 0.55rem;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.5625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #38b6ff;
}

.pricing-name {
  margin: 0;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.65rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8b93a7;
}

.pricing-price {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.pricing-price span {
  font-size: 2.25rem;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: #f4f5f7;
}

.pricing-price em {
  font-style: normal;
  font-size: 0.75rem;
  color: #8b93a7;
}

.pricing-desc {
  margin: 0;
  min-height: 2.5rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #8b93a7;
}

.pricing-devices {
  margin: 0 0 0.5rem;
  padding-top: 0.85rem;
  border-top: 1px solid #2a2f3a;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  color: #e8eaef;
}

/* Final CTA */
.final-cta {
  padding: 5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
  text-align: center;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(56, 182, 255, 0.1), transparent 55%),
    #0f1115;
}

.final-cta .section-body {
  margin-top: 1rem;
}

/* FAQ */
.faq {
  padding: 4.5rem 1.25rem;
  border-top: 1px solid #2a2f3a;
}

.faq-list {
  max-width: 44rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.faq-item {
  border: 1px solid #2a2f3a;
  border-radius: 0.85rem;
  background: #1a1d24;
  overflow: hidden;
}

.faq-item summary {
  cursor: pointer;
  list-style: none;
  padding: 1.1rem 1.25rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #f4f5f7;
}

.faq-item summary::-webkit-details-marker {
  display: none;
}

.faq-item summary::after {
  content: '+';
  float: right;
  color: #38b6ff;
  font-weight: 500;
}

.faq-item[open] summary::after {
  content: '−';
}

.faq-item p {
  margin: 0;
  padding: 0 1.25rem 1.2rem;
  font-size: 0.9rem;
  line-height: 1.65;
  color: #8b93a7;
}

/* Footer */
.footer {
  border-top: 1px solid #2a2f3a;
  padding: 3.5rem 0 2rem;
}

.footer-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0 1.25rem;
}

.footer-grid {
  display: grid;
  gap: 2.5rem;
}

@media (min-width: 640px) {
  .footer-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .footer-grid {
    grid-template-columns: 1.4fr repeat(3, 1fr);
  }
}

.footer-brand :deep(.struct-logo) {
  margin-inline: 0;
  height: 2.25rem;
}

.footer-brand p {
  margin: 0.85rem 0 0;
  max-width: 16rem;
  font-size: 0.8125rem;
  color: #8b93a7;
}

.footer-status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: #8b93a7;
}

.footer-status:hover {
  color: #38b6ff;
}

.footer-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #28c840;
  box-shadow: 0 0 0 3px rgba(40, 200, 64, 0.18);
}

.footer h3 {
  margin: 0 0 1rem;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #f4f5f7;
}

.footer ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.footer a {
  font-size: 0.8125rem;
  color: #8b93a7;
}

.footer a:hover {
  color: #38b6ff;
}

.footer-bottom {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid #2a2f3a;
}

@media (min-width: 640px) {
  .footer-bottom {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
}

.footer-bottom p {
  margin: 0;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: #5a6275;
}

.footer-note {
  opacity: 0.85;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-copy,
  .hero-shot {
    animation: none;
  }

  .hero-word-enter-active,
  .hero-word-leave-active {
    transition: none;
  }

  .hero-word-enter-from,
  .hero-word-leave-to {
    opacity: 1;
    transform: none;
  }

  @media (min-width: 1024px) {
    .hero-shot {
      transform: translate(-1.5rem, -50%) scale(0.95);
    }
  }

  .product-card:hover {
    transform: none;
  }
}
</style>

<template>
  <div class="landing">
    <!-- Nav -->
    <header class="landing-nav">
      <NuxtLink to="/" class="flex min-w-0 items-center justify-center">
        <StructLogo size="md" />
      </NuxtLink>
      <div class="flex shrink-0 items-center gap-2 sm:gap-3">
        <template v-if="user">
          <NuxtLink to="/dashboard" class="btn-primary text-xs">Open dashboard</NuxtLink>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="btn-ghost text-xs">Sign in</NuxtLink>
          <NuxtLink to="/signup" class="btn-primary text-xs">Start free</NuxtLink>
        </template>
      </div>
    </header>

    <!-- Hero -->
    <section class="hero">
      <div class="hero-grid" aria-hidden="true" />
      <div class="hero-layout">
        <div class="hero-copy min-w-0 text-left">
          <h1
            class="font-display max-w-xl text-[2.35rem] font-semibold leading-[1.08] tracking-[-0.04em] text-[#F4F5F7] sm:text-5xl lg:text-[3.5rem]"
          >
            Multiply Your Battery Life by
            <span class="text-[#38B6FF]">10x.</span>
          </h1>

          <p class="mt-5 max-w-md text-base leading-relaxed text-[#8B93A7] sm:text-lg">
            Ditch the heavy JSON and TLS handshakes. Securely route encrypted, raw C++ structs to
            your cloud using 80% less bandwidth.
          </p>

          <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <NuxtLink to="/signup" class="btn-primary px-6 py-3 text-sm">
              Connect your first device free
            </NuxtLink>
            <a href="#math" class="btn-ghost px-6 py-3 text-sm">See the proof</a>
          </div>

          <div class="terminal mt-8 max-w-md text-left" aria-label="Payload size comparison">
            <div class="terminal-chrome">
              <span class="dot dot-r" />
              <span class="dot dot-y" />
              <span class="dot dot-g" />
              <span class="terminal-title font-mono">struct — uplink</span>
            </div>
            <pre class="terminal-body font-mono"><span class="t-muted">$</span> <span class="t-cmd">compare</span> <span class="t-flag">--payload</span>
<span class="t-dim">JSON</span>   <span class="t-strike">85B</span>  <span class="t-dim">· radio</span> <span class="t-strike">200ms</span>
<span class="t-ok">STRUCT</span> <span class="t-hi">25B</span>  <span class="t-dim">· radio</span> <span class="t-hi">20ms</span>
<span class="t-muted">→</span> <span class="t-dim">85B JSON</span> <span class="t-muted">→</span> <span class="t-hi">25B packed struct</span><span class="cursor" aria-hidden="true" /></pre>
          </div>
        </div>

        <div class="hero-visual">
          <img
            src="/hero-shot.svg"
            alt="Struct gateway parsing packed ESP32 telemetry into live cloud dashboards"
            class="hero-shot"
            width="1200"
            height="600"
            decoding="async"
            fetchpriority="high"
          />
        </div>
      </div>
    </section>

    <!-- Math / Proof — split + bento -->
    <section id="math" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-12 lg:gap-14 lg:items-center">
        <div class="lg:col-span-5">
          <p class="label mb-3">The math</p>
          <h2
            class="font-display text-3xl font-semibold leading-[1.15] tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
          >
            JSON/MQTT is the silent battery killer.
          </h2>
          <p class="mt-5 text-base leading-relaxed text-[#8B93A7]">
            Every curly brace, every heap alloc, every extra millisecond the radio stays awake —
            paid for in joules on the edge. Struct ships the packed C++ layout your firmware
            already has. No serializer. No tax.
          </p>
          <p class="mt-6 font-mono text-[11px] text-[#8B93A7]">
            vs ArduinoJson · vs MQTT keepalives · vs TLS handshakes
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-3 lg:col-span-7 lg:grid-cols-1 lg:gap-3">
          <article
            v-for="card in mathCards"
            :key="card.label"
            class="bento-card group"
          >
            <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8B93A7]">
              {{ card.label }}
            </p>
            <div class="mt-3 flex items-end justify-between gap-4">
              <div class="min-w-0">
                <p class="metric-row">
                  <span class="metric-num">{{ card.winLead }}</span>
                  <span v-if="card.winTail" class="metric-tail">{{ card.winTail }}</span>
                </p>
                <p class="mt-1 font-mono text-xs text-[#8B93A7]">{{ card.winNote }}</p>
              </div>
              <div class="text-right">
                <p class="font-mono text-sm text-[#5A6275] line-through decoration-[#5A6275]/80">
                  {{ card.lose }}
                </p>
                <p class="mt-0.5 font-mono text-[10px] text-[#5A6275]">{{ card.loseNote }}</p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- Architecture with packet motion -->
    <section id="architecture" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-14 text-center">
          <p class="label mb-2 text-center">Architecture</p>
          <h2
            class="font-display text-3xl font-semibold tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
          >
            You're the edge. We're the middleman.
          </h2>
          <p class="mx-auto mt-3 max-w-xl text-sm text-[#8B93A7]">
            Keep devices dumb and deterministic. Struct authenticates, parses, and forwards clean
            JSON into systems you already trust.
          </p>
        </div>

        <!-- Desktop: three nodes with gap-only connectors -->
        <div
          class="arch-desk hidden lg:grid lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center lg:gap-0"
        >
          <div class="arch-node">
            <div class="arch-glyph">01</div>
            <h3 class="arch-title">Dumb Edge Device</h3>
            <p class="arch-body">
              ESP32 packs a fixed struct. No ArduinoJson. Sends
              <span class="font-mono text-[#38B6FF]">25 raw bytes</span> over TCP.
            </p>
          </div>
          <div class="arch-gap" aria-hidden="true">
            <span class="arch-gap-line" />
            <span class="font-mono text-[10px] text-[#5A6275]">25B</span>
          </div>
          <div class="arch-node arch-node--accent">
            <div class="arch-glyph text-[#38B6FF]">02</div>
            <h3 class="arch-title">Struct Gateway</h3>
            <p class="arch-body">
              Authenticates, optionally ChaCha20-descrambles, parses with your schema, routes
              securely.
            </p>
          </div>
          <div class="arch-gap" aria-hidden="true">
            <span class="arch-gap-line" />
            <span class="font-mono text-[10px] text-[#5A6275]">JSON</span>
          </div>
          <div class="arch-node">
            <div class="arch-glyph">03</div>
            <h3 class="arch-title">Enterprise Cloud</h3>
            <p class="arch-body">
              Clean JSON to
              <span class="text-[#E8EAEF]">AWS IoT</span>,
              <span class="text-[#E8EAEF]">Datadog</span>, or your webhooks.
            </p>
          </div>
        </div>

        <!-- Mobile stack -->
        <div class="flex flex-col gap-3 lg:hidden">
          <div class="arch-node">
            <div class="arch-glyph">01 · Edge</div>
            <h3 class="arch-title">Dumb Edge Device</h3>
            <p class="arch-body">
              Sends <span class="font-mono text-[#38B6FF]">25 raw bytes</span> over TCP.
            </p>
          </div>
          <div class="arch-gap-m" aria-hidden="true">
            <span class="arch-gap-line-m" />
          </div>
          <div class="arch-node arch-node--accent">
            <div class="arch-glyph text-[#38B6FF]">02 · Gateway</div>
            <h3 class="arch-title">Struct Gateway</h3>
            <p class="arch-body">Auth · parse · route.</p>
          </div>
          <div class="arch-gap-m" aria-hidden="true">
            <span class="arch-gap-line-m" />
          </div>
          <div class="arch-node">
            <div class="arch-glyph">03 · Cloud</div>
            <h3 class="arch-title">Enterprise Cloud</h3>
            <p class="arch-body">AWS IoT · Datadog · webhooks.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Pricing -->
    <section id="pricing" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto max-w-[96rem] px-4 sm:px-6">
        <div class="mb-14 text-center">
          <p class="label mb-2 text-center">Pricing</p>
          <h2
            class="font-display text-3xl font-semibold tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
          >
            Start free. Scale when your fleet does.
          </h2>
          <p class="mx-auto mt-3 max-w-xl text-sm text-[#8B93A7]">
            Every plan includes the binary telemetry gateway, dashboard, and live debugger.
          </p>
        </div>

        <div
          v-for="group in pricingGroups"
          :key="group.label"
          class="pricing-group"
        >
          <div class="mb-4 flex items-center gap-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8B93A7]">
              {{ group.label }}
            </p>
            <span class="h-px flex-1 bg-[#2A2F3A]" />
          </div>
          <div class="pricing-grid" :class="`pricing-grid--${group.layout}`">
            <article
              v-for="plan in group.plans"
              :key="plan.name"
              class="pricing-card"
              :class="{ 'pricing-card--featured': plan.featured }"
            >
            <span v-if="plan.featured" class="pricing-badge">Most popular</span>
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8B93A7]">
              {{ plan.name }}
            </p>
            <div class="mt-5 flex items-baseline gap-1.5">
              <span class="font-display text-4xl font-semibold tracking-[-0.04em] text-[#F4F5F7]">
                {{ plan.price }}
              </span>
              <span v-if="plan.interval" class="font-mono text-xs text-[#8B93A7]">
                {{ plan.interval }}
              </span>
            </div>
            <p class="mt-3 min-h-10 text-sm leading-relaxed text-[#8B93A7]">
              {{ plan.description }}
            </p>
            <p class="mt-5 border-t border-[#2A2F3A] pt-5 font-mono text-xs text-[#E8EAEF]">
              {{ plan.devices }}
            </p>
            <p v-if="plan.deviceRate" class="mt-2 font-mono text-xs text-[#38B6FF]">
              {{ plan.deviceRate }}
            </p>
            <ul class="mt-5 flex-1 space-y-2.5 text-sm text-[#8B93A7]">
              <li v-for="feature in plan.features" :key="feature" class="flex gap-2.5">
                <span class="text-[#38B6FF]">✓</span>
                <span>{{ feature }}</span>
              </li>
            </ul>
            <NuxtLink
              :to="plan.to"
              class="mt-7 inline-flex w-full items-center justify-center px-5 py-3 text-xs"
              :class="plan.featured ? 'btn-primary' : 'btn-ghost'"
            >
              {{ plan.cta }}
            </NuxtLink>
              </article>
            </div>
          </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="border-t border-[#2A2F3A] py-20">
      <div class="mx-auto max-w-3xl px-6 text-center">
        <h2 class="font-display text-3xl font-semibold tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl">
          Ship your first packed uplink today.
        </h2>
        <p class="mt-4 text-sm text-[#8B93A7]">
          Create a free device, drop in the ESP32 header Struct generates, and watch live telemetry
          land — with destinations, fleet tags, ChaCha20, and downlinks included.
        </p>
        <NuxtLink to="/signup" class="btn-primary mt-8 inline-flex px-8 py-3.5">
          Start free — get your API key
        </NuxtLink>
      </div>
    </section>

    <footer class="border-t border-[#2A2F3A] py-8">
      <div
        class="mx-auto flex max-w-5xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
      >
        <p class="font-mono text-[11px] text-[#8B93A7]">Struct · binary telemetry gateway</p>
        <NuxtLink to="/login" class="text-xs text-[#8B93A7] hover:text-[#38B6FF]">Sign in</NuxtLink>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const user = useSupabaseUser()

useSeoMeta({
  title: 'Struct — Multiply Your Battery Life by 10x',
  description:
    'Ditch heavy JSON and TLS handshakes. Securely route encrypted, raw C++ structs to your cloud using 80% less bandwidth.',
})

const mathCards = [
  {
    label: 'Payload Size',
    winLead: '4×',
    winTail: 'smaller',
    winNote: '25B packed vs 85B+ JSON',
    lose: '85B+',
    loseNote: 'JSON',
  },
  {
    label: 'CPU Awake Time',
    winLead: '10×',
    winTail: 'faster',
    winNote: '20ms vs 200ms radio on-air',
    lose: '200ms',
    loseNote: 'JSON / MQTT',
  },
  {
    label: 'Crash Risk',
    winLead: 'Zero',
    winTail: '',
    winNote: 'fixed memory',
    lose: 'High',
    loseNote: 'heap fragmentation',
  },
]

const pricingPlans = [
  {
    name: 'Free (Developer)',
    price: '$0',
    interval: 'forever',
    description: 'Build, connect, and validate your first edge fleet.',
    devices: 'Up to 5 devices',
    deviceRate: '',
    features: ['Standard dashboard', 'Basic webhooks', '24-hour telemetry retention'],
    cta: 'Start free',
    to: '/signup',
    featured: false,
  },
  {
    name: 'Flexible',
    price: '$1.00',
    interval: 'per device / month',
    description: 'Start small and scale your fleet one device at a time.',
    devices: 'Minimum 5 devices',
    deviceRate: '',
    features: ['Everything in Free', 'Automatic device scaling', '7-day telemetry retention'],
    cta: 'Choose Flexible',
    to: '/signup',
    featured: false,
  },
  {
    name: 'Pro',
    price: '$49',
    interval: '/ month',
    description: 'Secure operations and bulk pricing for growing fleets.',
    devices: '155-device starting allowance',
    deviceRate: '$0.50 per extra device / month',
    features: ['ChaCha20 encryption', 'Device downlinks', '30-day telemetry retention'],
    cta: 'Choose Pro',
    to: '/signup',
    featured: true,
  },
  {
    name: 'Scale',
    price: '$249',
    interval: '/ month',
    description: 'Governance and advanced routing for large fleets.',
    devices: '1,005-device starting allowance',
    deviceRate: '$0.20 per extra device / month',
    features: ['Team RBAC', 'Immutable audit logs', 'Webhook logical routing'],
    cta: 'Buy Now',
    to: '/signup',
    featured: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    interval: '',
    description: 'Custom infrastructure and commercial terms for demanding fleets.',
    devices: 'Custom device allowance',
    deviceRate: '',
    features: ['SAML SSO', 'Dedicated ingestion ports', 'Custom SLAs'],
    cta: 'Contact sales',
    to: 'mailto:sales@struct.dev?subject=Struct Enterprise',
    featured: false,
  },
]

const pricingGroups = [
  {
    label: 'Self-serve',
    layout: 'self-serve',
    plans: pricingPlans.slice(0, 3),
  },
  {
    label: 'Scale & Enterprise',
    layout: 'scale',
    plans: pricingPlans.slice(3),
  },
]
</script>

<style scoped>
.landing {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
}

.font-display {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
}

.landing-nav {
  @apply sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[#2A2F3A] bg-[#0F1115]/80 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4;
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 7.5rem 0 8rem;
}

@media (min-width: 640px) {
  .hero {
    padding: 9rem 0 9.5rem;
  }
}

@media (min-width: 1024px) {
  .hero {
    padding: 10.5rem 0 11rem;
  }
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(42, 47, 58, 0.22) 1px, transparent 1px),
    linear-gradient(90deg, rgba(42, 47, 58, 0.22) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 80% 70% at 78% 42%, black 18%, transparent 78%);
  pointer-events: none;
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
    padding-left: max(1.5rem, calc((100vw - 72rem) / 2));
    padding-right: 0;
  }
}

.hero-copy {
  animation: hero-copy-in 0.75s cubic-bezier(0.22, 1, 0.36, 1) both;
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
  max-height: min(44vh, 340px);
  object-fit: contain;
  object-position: center center;
  margin-inline: auto;
  filter: drop-shadow(0 28px 48px rgba(0, 0, 0, 0.45));
  animation: hero-in 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@media (min-width: 1024px) {
  .hero-shot {
    position: absolute;
    left: 6%;
    top: 50%;
    width: 140%;
    max-width: 62rem;
    max-height: 560px;
    height: auto;
    margin: 0;
    object-fit: contain;
    object-position: left center;
    transform: translateY(-50%);
    animation-name: hero-in-lg;
  }
}

/* Glass terminal under CTAs */
.terminal {
  border-radius: 12px;
  border: 1px solid rgba(42, 47, 58, 0.9);
  background: linear-gradient(
    165deg,
    rgba(26, 29, 36, 0.72) 0%,
    rgba(15, 17, 21, 0.88) 100%
  );
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 24px 48px -24px rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  overflow: hidden;
}

.terminal-chrome {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(42, 47, 58, 0.85);
  background: rgba(15, 17, 21, 0.45);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  flex-shrink: 0;
}
.dot-r {
  background: #ff5f57;
}
.dot-y {
  background: #febc2e;
}
.dot-g {
  background: #28c840;
}

.terminal-title {
  margin-left: 8px;
  font-size: 10px;
  color: #5a6275;
}

.terminal-body {
  margin: 0;
  padding: 14px 16px 16px;
  font-size: 12px;
  line-height: 1.7;
  text-align: left;
  white-space: pre;
  overflow-x: auto;
}

.t-muted {
  color: #5a6275;
}
.t-cmd {
  color: #e8eaef;
}
.t-flag {
  color: #8b93a7;
}
.t-dim {
  color: #6b7388;
}
.t-strike {
  color: #5a6275;
  text-decoration: line-through;
  text-decoration-color: rgba(90, 98, 117, 0.85);
}
.t-ok {
  color: #38b6ff;
}
.t-hi {
  color: #38b6ff;
  text-shadow: 0 0 12px rgba(56, 182, 255, 0.35);
}

.cursor {
  display: inline-block;
  width: 7px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: #38b6ff;
  box-shadow: 0 0 10px rgba(56, 182, 255, 0.55);
  animation: caret-blink 1.05s step-end infinite;
}

@keyframes caret-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
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
    transform: translateY(calc(-50% + 20px)) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(-50%) scale(1);
  }
}

@keyframes hero-copy-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-shot,
  .hero-copy {
    animation: none;
  }

  .cursor {
    animation: none;
    opacity: 1;
  }

  @media (min-width: 1024px) {
    .hero-shot {
      transform: translateY(-50%);
    }
  }
}

/* Math bento cards */
.bento-card {
  border-radius: 14px;
  border: 1px solid #2a2f3a;
  background: #1a1d24;
  padding: 1.25rem 1.35rem;
  overflow: visible;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.bento-card:hover {
  border-color: rgba(56, 182, 255, 0.35);
  box-shadow: 0 0 0 1px rgba(56, 182, 255, 0.08);
}

.metric-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.45rem;
  margin: 0;
  line-height: 1.1;
}

.metric-num {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(2.25rem, 4vw, 3rem);
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1;
  color: #38b6ff;
}

.metric-tail {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  font-size: 1.05rem;
  font-weight: 500;
  line-height: 1.2;
  color: #a8b2c4;
}

/* Architecture */
.arch-desk {
  width: 100%;
}

.arch-node {
  @apply relative rounded-xl border border-[#2A2F3A] bg-[#1A1D24] p-5;
}

.arch-node--accent {
  border-color: rgba(56, 182, 255, 0.28);
  background: linear-gradient(160deg, rgba(56, 182, 255, 0.05), rgba(26, 29, 36, 1) 55%);
  box-shadow: 0 0 40px -16px rgba(56, 182, 255, 0.3);
}

.arch-glyph {
  @apply mb-3 font-mono text-[10px] tracking-widest text-[#8B93A7];
}

.arch-title {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  @apply text-base font-semibold tracking-tight text-[#E8EAEF];
}

.arch-body {
  @apply mt-2 text-sm leading-relaxed text-[#8B93A7];
}

.arch-gap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 64px;
  flex-shrink: 0;
}

.arch-gap-line {
  display: block;
  width: 40px;
  height: 1px;
  background: repeating-linear-gradient(
    to right,
    #2a2f3a 0 4px,
    transparent 4px 8px
  );
}

.arch-gap-m {
  display: flex;
  justify-content: center;
  height: 20px;
}

.arch-gap-line-m {
  display: block;
  width: 1px;
  height: 100%;
  background: repeating-linear-gradient(
    to bottom,
    #2a2f3a 0 3px,
    transparent 3px 6px
  );
}

/* Pricing */
.pricing-grid {
  display: grid;
  gap: 1rem;
}

.pricing-group + .pricing-group {
  margin-top: 3.5rem;
}

.pricing-card {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  border: 1px solid #2a2f3a;
  border-radius: 16px;
  background: #1a1d24;
  padding: 2rem;
}

.pricing-card--featured {
  border-color: rgba(56, 182, 255, 0.58);
  background: linear-gradient(165deg, rgba(56, 182, 255, 0.09), #1a1d24 48%);
  box-shadow:
    0 0 0 1px rgba(56, 182, 255, 0.08),
    0 28px 55px -32px rgba(56, 182, 255, 0.58);
}

.pricing-badge {
  position: absolute;
  top: 0;
  right: 1.25rem;
  transform: translateY(-50%);
  border: 1px solid rgba(56, 182, 255, 0.5);
  border-radius: 999px;
  background: #101b24;
  padding: 0.3rem 0.65rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #38b6ff;
}

@media (min-width: 768px) {
  .pricing-grid--self-serve {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .pricing-grid--scale {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: calc((100% - 1rem) * 2 / 3);
    margin-inline: auto;
  }

  .pricing-grid {
    align-items: stretch;
    padding-top: 1.25rem;
  }

  .pricing-card--featured {
    transform: translateY(-1.25rem);
  }

  .pricing-grid .pricing-card {
    min-height: 32rem;
  }
}

</style>

<template>
  <div class="landing">
    <!-- Nav -->
    <header class="landing-nav">
      <NuxtLink to="/" class="ml-3 flex min-w-0 items-center justify-center sm:ml-5">
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
      <div
        id="parallax-grid"
        ref="parallaxGridEl"
        class="hero-grid"
        aria-hidden="true"
      />
      <div class="hero-layout">
        <div class="hero-copy min-w-0 text-left">
          <h1
            class="font-display max-w-xl text-[2.35rem] font-semibold leading-[1.08] tracking-[-0.04em] text-[#F4F5F7] sm:text-5xl lg:text-[3.5rem]"
          >
            Save more battery.
            <span class="text-[#38B6FF]">Send fewer bytes.</span>
          </h1>

          <p class="mt-5 max-w-md text-base leading-relaxed text-[#8B93A7] sm:text-lg">
            Replace verbose JSON with secure packed C++ structs. Keep cellular radios asleep
            longer and stop paying to transmit field names, braces, and quotes.
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
            <pre class="terminal-body font-mono"><span class="t-muted">$</span> <span class="t-cmd">compare</span> <span class="t-flag">--demo two-sensor</span>
<span class="t-dim">JSON</span>   <span class="t-strike">85B</span>  <span class="t-dim">· names + syntax repeated</span>
<span class="t-ok">STRUCT</span> <span class="t-hi">25B</span>  <span class="t-dim">· fixed binary frame</span>
<span class="t-muted">→</span> <span class="t-dim">one small example</span> <span class="t-muted">·</span> <span class="t-hi">your schema sets the size</span><span class="cursor" aria-hidden="true" /></pre>
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

    <!-- Bandwidth economics -->
    <section id="bandwidth" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="bandwidth-shell">
          <div class="max-w-xl">
            <p class="label mb-3">Fleet economics</p>
            <h2
              class="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
            >
              You pay for every byte.
              <span class="text-[#38B6FF]">Stop sending syntax.</span>
            </h2>
            <p class="mt-5 text-base leading-relaxed text-[#8B93A7]">
              On LTE-M and NB-IoT, JSON overhead is not just a battery problem—it is a line item.
              Struct sends the values your fleet measured, not field names, braces, and quotes on
              every transmission.
            </p>
            <div class="mt-7 flex flex-wrap gap-2">
              <span class="signal-chip">LTE-M</span>
              <span class="signal-chip">NB-IoT</span>
              <span class="signal-chip">Satellite</span>
              <span class="signal-chip">Metered SIMs</span>
            </div>
          </div>

          <div class="bandwidth-meter" aria-label="Payload bandwidth comparison">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="font-mono text-[10px] uppercase tracking-[0.15em] text-[#8B93A7]">
                  Per 10M readings
                </p>
                <p class="mt-2 font-display text-4xl font-semibold tracking-[-0.04em] text-[#38B6FF]">
                  1.72 GB
                </p>
                <p class="mt-1 text-xs text-[#8B93A7]">less application payload transmitted</p>
              </div>
              <div class="savings-ring">
                <span class="font-display text-xl font-semibold text-[#F4F5F7]">78%</span>
                <span class="font-mono text-[8px] uppercase tracking-wider text-[#8B93A7]">smaller</span>
              </div>
            </div>

            <div class="mt-8 space-y-5">
              <div>
                <div class="mb-2 flex justify-between font-mono text-[10px]">
                  <span class="text-[#8B93A7]">12-field JSON reading</span>
                  <span class="text-[#E8EAEF]">~220 bytes</span>
                </div>
                <div class="meter-track"><span class="meter-json" /></div>
              </div>
              <div>
                <div class="mb-2 flex justify-between font-mono text-[10px]">
                  <span class="text-[#8B93A7]">12 packed sensor values</span>
                  <span class="text-[#38B6FF]">48 bytes</span>
                </div>
                <div class="meter-track"><span class="meter-struct" /></div>
              </div>
            </div>
            <p class="mt-6 text-[10px] leading-relaxed text-[#5A6275]">
              Illustrative 12-field application-data profile, excluding transport framing. Actual
              savings depend on field names, value types, carrier, and send frequency.
            </p>
          </div>
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
              ESP32 packs a fixed struct. No ArduinoJson. Sends a
              <span class="font-mono text-[#38B6FF]">schema-sized binary frame</span> over TCP.
            </p>
          </div>
          <div class="arch-gap" aria-hidden="true">
            <span class="arch-gap-line" />
            <span class="font-mono text-[10px] text-[#5A6275]">BINARY</span>
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
              Sends a <span class="font-mono text-[#38B6FF]">schema-sized frame</span> over TCP.
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

    <!-- Live debugger -->
    <section id="debugger" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p class="label mb-3">Live debugger</p>
          <h2
            class="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
          >
            Zero-friction troubleshooting.
          </h2>
          <p class="mt-5 text-base leading-relaxed text-[#8B93A7]">
            Raw TCP should not mean debugging blind. Build a test frame from your real schema and
            inspect the exact wire bytes beside the parsed JSON—without powering a device or
            sending traffic.
          </p>
          <ul class="mt-7 space-y-3 text-sm text-[#A8B2C4]">
            <li class="feature-line">
              <span class="feature-mark">01</span>
              Generate little-endian frames from typed values
            </li>
            <li class="feature-line">
              <span class="feature-mark">02</span>
              See schema version, byte offsets, and payload size
            </li>
            <li class="feature-line">
              <span class="feature-mark">03</span>
              Compare raw hex with decoded JSON instantly
            </li>
          </ul>
          <NuxtLink to="/signup" class="btn-ghost mt-8 inline-flex px-5 py-3 text-xs">
            Debug your first frame
          </NuxtLink>
        </div>

        <div class="debug-window" aria-label="Struct live debugger preview">
          <div class="debug-topbar">
            <div class="flex items-center gap-2">
              <span class="dot dot-r" />
              <span class="dot dot-y" />
              <span class="dot dot-g" />
            </div>
            <span class="font-mono text-[10px] text-[#5A6275]">live-debugger / schema v3</span>
            <span class="debug-status">LOCAL</span>
          </div>
          <div class="debug-grid">
            <div class="debug-pane">
              <p class="debug-label">Test values</p>
              <div class="debug-fields">
                <div class="debug-field">
                  <span>temperature</span><strong>72.5</strong><em>float32</em>
                </div>
                <div class="debug-field">
                  <span>humidity</span><strong>45</strong><em>uint8</em>
                </div>
                <div class="debug-field">
                  <span>online</span><strong>true</strong><em>boolean</em>
                </div>
              </div>
              <p class="debug-label mt-6">Raw wire frame · 23 bytes</p>
              <div class="hex-block font-mono">
                <span class="hex-key">61 38 66 32</span> 63 39 65 31<br />
                34 64 37 62 35 30 61 33<br />
                <span class="hex-version">03</span> <span class="hex-data">00 00 91 42 2d 01</span>
              </div>
            </div>
            <div class="debug-pane debug-pane--result">
              <div class="flex items-center justify-between">
                <p class="debug-label">Parsed output</p>
                <span class="parse-ok">VALID FRAME</span>
              </div>
              <pre class="json-block font-mono"><span class="json-brace">{</span>
  <span class="json-key">"temperature"</span>: <span class="json-value">72.5</span>,
  <span class="json-key">"humidity"</span>: <span class="json-value">45</span>,
  <span class="json-key">"online"</span>: <span class="json-bool">true</span>
<span class="json-brace">}</span></pre>
              <div class="mt-6 grid grid-cols-3 gap-2">
                <div class="debug-stat"><strong>v3</strong><span>schema</span></div>
                <div class="debug-stat"><strong>6B</strong><span>payload</span></div>
                <div class="debug-stat"><strong>0</strong><span>errors</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Security -->
    <section id="security" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="security-intro">
          <div>
            <p class="label mb-3">Security & reliability</p>
            <h2
              class="font-display max-w-2xl text-3xl font-semibold leading-[1.12] tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
            >
              Fleet security that does not depend on trust.
            </h2>
          </div>
          <p class="max-w-md text-sm leading-relaxed text-[#8B93A7]">
            Protect data in motion, reject replayed packets, isolate every organization, and keep a
            durable record of infrastructure changes.
          </p>
        </div>

        <div class="mt-6 flex items-start gap-3 rounded-lg border border-[#38B6FF]/20 bg-[#38B6FF]/5 p-4">
          <span class="mt-0.5 font-mono text-xs text-[#38B6FF]">✓</span>
          <p class="text-sm leading-relaxed text-[#A8B2C4]">
            <strong class="font-semibold text-[#E8EAEF]">Zero Plaintext Secrets:</strong>
            Device API keys never cross the wire. All payloads are authenticated via HMAC-SHA256.
          </p>
        </div>

        <div class="security-grid mt-12">
          <article class="security-card security-card--wide">
            <div class="security-icon">ENC</div>
            <p class="security-kicker">Payload protection</p>
            <h3 class="security-title">ChaCha20-Poly1305 encryption</h3>
            <p class="security-copy">
              Authenticated encryption protects telemetry confidentiality and integrity without
              burdening constrained MCUs. Timestamp checks and nonce tracking reject stale or
              duplicated encrypted uplinks.
            </p>
            <div class="crypto-strip font-mono">
              <span>12B NONCE</span><i />
              <span>ENCRYPTED PAYLOAD</span><i />
              <span>16B AUTH TAG</span>
            </div>
          </article>

          <article class="security-card">
            <div class="security-icon">RBAC</div>
            <p class="security-kicker">Tenant boundaries</p>
            <h3 class="security-title">Strict organization isolation</h3>
            <p class="security-copy">
              Postgres Row Level Security and server-side role checks enforce owner, admin, and
              viewer boundaries—even when requests bypass the UI.
            </p>
          </article>

          <article class="security-card">
            <div class="security-icon">LOG</div>
            <p class="security-kicker">Accountability</p>
            <h3 class="security-title">Immutable audit logs</h3>
            <p class="security-copy">
              Scale workspaces retain actor, previous state, and new state for device, schema, and
              destination changes.
            </p>
          </article>

          <article class="security-card">
            <div class="security-icon">CMD</div>
            <p class="security-kicker">Controlled operations</p>
            <h3 class="security-title">Typed command downlinks</h3>
            <p class="security-copy">
              Queue interval changes, reboots, or custom byte commands through authenticated device
              records instead of maintaining a second control plane.
            </p>
          </article>
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
  title: 'Struct — Save More Battery and Bandwidth on IoT',
  description:
    'Replace verbose JSON with secure packed structs. Cut cellular payload, debug raw TCP visually, and protect fleets with authenticated encryption.',
})

const parallaxGridEl = ref<HTMLElement | null>(null)
const prefersReducedMotion = ref(false)

function onLandingScroll() {
  const layer = parallaxGridEl.value
  if (!layer) return
  if (prefersReducedMotion.value) {
    layer.style.transform = 'translateY(0px)'
    return
  }
  // Same motor as the reference: layer lags behind content (scrollY * 0.5).
  layer.style.transform = `translateY(${window.scrollY * 0.5}px)`
}

onMounted(() => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  onLandingScroll()
  window.addEventListener('scroll', onLandingScroll, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onLandingScroll)
})

const mathCards = [
  {
    label: 'Payload Size',
    winLead: '4×',
    winTail: 'smaller',
    winNote: 'packed binary vs verbose JSON',
    lose: 'JSON',
    loseNote: 'keys + syntax',
  },
  {
    label: 'CPU Awake Time',
    winLead: '10×',
    winTail: 'faster',
    winNote: 'less work before the radio sleeps',
    lose: 'Slow',
    loseNote: 'JSON / MQTT',
  },
  {
    label: 'Crash Risk',
    winLead: 'Zero',
    winTail: '',
    winNote: 'fixed-memory serialization',
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
  font-family: 'Lato', ui-sans-serif, system-ui, sans-serif;
}

.font-display {
  font-family: 'Lato', ui-sans-serif, system-ui, sans-serif;
}

.landing-nav {
  @apply sticky top-0 z-20 flex h-20 items-center justify-between gap-3 border-b border-[#2A2F3A] bg-[#0F1115]/80 px-4 backdrop-blur-xl sm:px-6;
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
  height: 150%;
  background-image:
    linear-gradient(rgba(42, 47, 58, 0.22) 1px, transparent 1px),
    linear-gradient(90deg, rgba(42, 47, 58, 0.22) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 80% 70% at 78% 42%, black 18%, transparent 78%);
  pointer-events: none;
  transform: translateY(0px);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .hero-grid {
    will-change: auto;
    transform: none !important;
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
  font-family: 'Lato', ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(2.25rem, 4vw, 3rem);
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1;
  color: #38b6ff;
}

.metric-tail {
  font-family: 'Lato', ui-sans-serif, system-ui, sans-serif;
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
  font-family: 'Lato', ui-sans-serif, system-ui, sans-serif;
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

/* Bandwidth economics */
.bandwidth-shell {
  display: grid;
  gap: 3rem;
  align-items: center;
  border: 1px solid #2a2f3a;
  border-radius: 20px;
  padding: clamp(1.5rem, 4vw, 3.5rem);
  background:
    radial-gradient(circle at 85% 15%, rgba(56, 182, 255, 0.1), transparent 32%),
    #15181e;
  overflow: hidden;
}

@media (min-width: 900px) {
  .bandwidth-shell {
    grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.8fr);
  }
}

.signal-chip {
  border: 1px solid #2a2f3a;
  border-radius: 999px;
  padding: 0.4rem 0.7rem;
  background: rgba(15, 17, 21, 0.7);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: #8b93a7;
}

.bandwidth-meter {
  border: 1px solid rgba(56, 182, 255, 0.2);
  border-radius: 16px;
  padding: 1.5rem;
  background: rgba(15, 17, 21, 0.82);
  box-shadow: 0 28px 60px -36px rgba(56, 182, 255, 0.5);
}

.savings-ring {
  display: flex;
  width: 5.2rem;
  height: 5.2rem;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(56, 182, 255, 0.45);
  border-radius: 999px;
  background:
    radial-gradient(circle, #151b22 58%, transparent 60%),
    conic-gradient(#38b6ff 0 78%, #2a2f3a 78% 100%);
  box-shadow: 0 0 30px -10px rgba(56, 182, 255, 0.6);
}

.meter-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #242933;
}

.meter-json,
.meter-struct {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.meter-json {
  width: 100%;
  background: #596174;
}

.meter-struct {
  width: 22%;
  background: #38b6ff;
  box-shadow: 0 0 14px rgba(56, 182, 255, 0.6);
}

/* Debugger */
.feature-line {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.feature-mark {
  display: inline-flex;
  min-width: 2rem;
  height: 1.4rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(56, 182, 255, 0.25);
  border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  color: #38b6ff;
}

.debug-window {
  overflow: hidden;
  border: 1px solid #343a47;
  border-radius: 16px;
  background: #111319;
  box-shadow:
    0 40px 80px -42px rgba(0, 0, 0, 0.9),
    0 0 0 1px rgba(255, 255, 255, 0.025) inset;
}

.debug-topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 1rem;
  border-bottom: 1px solid #2a2f3a;
  padding: 0.75rem 1rem;
  background: #181b22;
}

.debug-status {
  justify-self: end;
  border: 1px solid rgba(56, 182, 255, 0.3);
  border-radius: 999px;
  padding: 0.2rem 0.45rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 7px;
  letter-spacing: 0.12em;
  color: #38b6ff;
}

.debug-grid {
  display: grid;
}

@media (min-width: 640px) {
  .debug-grid {
    grid-template-columns: 1fr 0.9fr;
  }
}

.debug-pane {
  min-width: 0;
  padding: 1.25rem;
}

.debug-pane--result {
  border-top: 1px solid #2a2f3a;
  background: rgba(26, 29, 36, 0.55);
}

@media (min-width: 640px) {
  .debug-pane--result {
    border-top: 0;
    border-left: 1px solid #2a2f3a;
  }
}

.debug-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #6b7388;
}

.debug-fields {
  margin-top: 0.75rem;
  overflow: hidden;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
}

.debug-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.65rem 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
}

.debug-field + .debug-field {
  border-top: 1px solid #242933;
}

.debug-field span {
  overflow: hidden;
  color: #8b93a7;
  text-overflow: ellipsis;
}

.debug-field strong {
  font-weight: 500;
  color: #e8eaef;
}

.debug-field em {
  font-size: 7px;
  font-style: normal;
  color: #596174;
}

.hex-block,
.json-block {
  margin: 0.75rem 0 0;
  border: 1px solid #242933;
  border-radius: 8px;
  padding: 0.85rem;
  background: #0c0e12;
  font-size: 10px;
  line-height: 1.8;
  color: #6b7388;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.hex-key {
  color: #596174;
}

.hex-version,
.json-bool {
  color: #c792ea;
}

.hex-data,
.json-value {
  color: #38b6ff;
}

.json-key {
  color: #a8b2c4;
}

.json-brace {
  color: #6b7388;
}

.parse-ok {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 7px;
  letter-spacing: 0.08em;
  color: #58d6a8;
}

.debug-stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border: 1px solid #242933;
  border-radius: 7px;
  padding: 0.6rem;
  text-align: center;
}

.debug-stat strong {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  color: #e8eaef;
}

.debug-stat span {
  font-size: 8px;
  color: #596174;
}

/* Security */
.security-intro {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

@media (min-width: 768px) {
  .security-intro {
    flex-direction: row;
    align-items: end;
    justify-content: space-between;
  }
}

.security-grid {
  display: grid;
  gap: 1rem;
}

@media (min-width: 768px) {
  .security-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .security-card--wide {
    grid-column: span 3;
  }
}

.security-card {
  position: relative;
  overflow: hidden;
  border: 1px solid #2a2f3a;
  border-radius: 16px;
  padding: 1.5rem;
  background: #1a1d24;
}

.security-card--wide {
  background:
    linear-gradient(110deg, rgba(56, 182, 255, 0.08), transparent 55%),
    #1a1d24;
}

.security-icon {
  display: inline-flex;
  height: 1.6rem;
  align-items: center;
  border: 1px solid rgba(56, 182, 255, 0.28);
  border-radius: 5px;
  padding: 0 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  letter-spacing: 0.1em;
  color: #38b6ff;
}

.security-kicker {
  margin-top: 1.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #6b7388;
}

.security-title {
  margin-top: 0.5rem;
  font-family: 'Lato', ui-sans-serif, system-ui, sans-serif;
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #e8eaef;
}

.security-copy {
  margin-top: 0.75rem;
  max-width: 48rem;
  font-size: 0.85rem;
  line-height: 1.65;
  color: #8b93a7;
}

.crypto-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  margin-top: 1.5rem;
  color: #6b7388;
  font-size: 8px;
  letter-spacing: 0.08em;
}

.crypto-strip i {
  width: 1.5rem;
  height: 1px;
  background: #343a47;
}

.crypto-strip span:nth-of-type(2) {
  color: #38b6ff;
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

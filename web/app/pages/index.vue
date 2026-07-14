<template>
  <div class="landing">
    <!-- Nav -->
    <header class="landing-nav">
      <NuxtLink to="/" class="flex items-center justify-center">
        <StructLogo size="md" class="max-w-[150px]" />
      </NuxtLink>
      <div class="flex items-center gap-3">
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
      <div class="relative mx-auto max-w-5xl px-6 pt-20 pb-24 text-center sm:pt-28 sm:pb-28">
        <p
          class="mb-6 inline-flex items-center gap-2 rounded-full border border-[#2A2F3A] bg-[#1A1D24]/80 px-3 py-1 font-mono text-[11px] text-[#8B93A7]"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-[#38B6FF] shadow-[0_0_10px_rgba(56,182,255,0.8)]" />
          Binary over TCP · No MQTT tax
        </p>

        <h1
          class="font-display mx-auto max-w-4xl text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-[#F4F5F7] sm:text-5xl lg:text-[3.75rem]"
        >
          The Ultra-Lightweight IoT Gateway for
          <span class="text-[#38B6FF]">Battery-Constrained Fleets.</span>
        </h1>

        <p class="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#8B93A7] sm:text-lg">
          Extend edge battery life by 10× and eliminate heap fragmentation. Send raw binary over
          TCP; we handle the secure routing, parsing, and cloud integration.
        </p>

        <div class="mt-10 flex flex-wrap items-center justify-center gap-3">
          <NuxtLink to="/signup" class="btn-primary px-6 py-3 text-sm">Build your gateway</NuxtLink>
          <a href="#math" class="btn-ghost px-6 py-3 text-sm">See the math →</a>
        </div>

        <!-- Glass terminal snippet -->
        <div class="terminal mx-auto mt-12 max-w-xl text-left">
          <div class="terminal-chrome">
            <span class="dot dot-r" />
            <span class="dot dot-y" />
            <span class="dot dot-g" />
            <span class="terminal-title font-mono">struct — uplink</span>
          </div>
          <pre class="terminal-body font-mono"><span class="t-muted">$</span> <span class="t-cmd">compare</span> <span class="t-flag">--payload</span>
<span class="t-dim">JSON</span>   <span class="t-strike">85B</span>  <span class="t-dim">· radio</span> <span class="t-strike">200ms</span>
<span class="t-ok">STRUCT</span> <span class="t-hi">25B</span>  <span class="t-dim">· radio</span> <span class="t-hi">20ms</span>
<span class="t-muted">→</span> <span class="t-dim">heap fragmentation:</span> <span class="t-hi">0</span></pre>
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

    <!-- CTA -->
    <section class="border-t border-[#2A2F3A] py-20">
      <div class="mx-auto max-w-3xl px-6 text-center">
        <h2 class="font-display text-3xl font-semibold tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl">
          Stop paying the JSON tax on every wake.
        </h2>
        <p class="mt-4 text-sm text-[#8B93A7]">
          Create a device, paste the API key into firmware, define the packed layout — telemetry
          shows up live. Destinations, fleet tags, encryption, and downlinks included.
        </p>
        <NuxtLink to="/signup" class="btn-primary mt-8 inline-flex px-8 py-3">
          Open the dashboard
        </NuxtLink>
      </div>
    </section>

    <footer class="border-t border-[#2A2F3A] py-8">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-6">
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
  title: 'Struct — Ultra-Lightweight IoT Gateway',
  description:
    'Extend edge battery life by 10×. Send raw binary over TCP; Struct handles secure routing, parsing, and cloud integration.',
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
</script>

<style scoped>
.landing {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
}

.font-display {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
}

.landing-nav {
  @apply sticky top-0 z-20 flex items-center justify-between border-b border-[#2A2F3A] bg-[#0F1115]/80 px-6 py-4 backdrop-blur-xl;
}

.hero {
  @apply relative overflow-hidden;
}

.hero-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(42, 47, 58, 0.28) 1px, transparent 1px),
    linear-gradient(90deg, rgba(42, 47, 58, 0.28) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 70% 55% at 50% 28%, black 15%, transparent 75%);
  pointer-events: none;
}

/* Glass terminal */
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
  padding: 16px 18px 18px;
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
</style>

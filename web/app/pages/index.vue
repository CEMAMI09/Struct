<template>
  <div class="landing">
    <!-- Nav -->
    <header class="nav">
      <NuxtLink to="/" class="nav-logo" aria-label="Struct home">
        <StructLogo size="md" />
      </NuxtLink>

      <nav class="nav-links" aria-label="Primary">
        <a href="#architecture">Platform</a>
        <a href="#sandbox">Products</a>
        <a href="#math">Use cases</a>
        <a href="#bandwidth">Integrations</a>
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
      <a href="#architecture" @click="menuOpen = false">Platform</a>
      <a href="#sandbox" @click="menuOpen = false">Products</a>
      <a href="#math" @click="menuOpen = false">Use cases</a>
      <a href="#bandwidth" @click="menuOpen = false">Integrations</a>
      <a href="#pricing" @click="menuOpen = false">Pricing</a>
      <NuxtLink
        v-if="!user"
        to="/login"
        class="mobile-menu-signin"
        @click="menuOpen = false"
      >
        Sign in
      </NuxtLink>
      <NuxtLink
        v-if="user"
        to="/dashboard"
        class="btn-primary mt-2 w-full"
        @click="menuOpen = false"
      >
        Open dashboard
      </NuxtLink>
      <NuxtLink
        v-else
        to="/signup"
        class="btn-primary mt-2 w-full"
        @click="menuOpen = false"
      >
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
            Keep devices dumb and deterministic. Send the smallest authenticated packet the
            workload allows; Struct handles parsing, schema interpretation, and cloud-friendly
            conversion.
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

    <!-- Compatible with — logo marquee -->
    <section class="compat" aria-label="Compatible platforms and tools">
      <p class="compat-label">MCU families and HTTPS webhook targets</p>
      <div class="compat-marquee" aria-hidden="true">
        <div class="compat-track">
          <div
            v-for="(logo, i) in [...compatLogos, ...compatLogos]"
            :key="`${logo.src}-${i}`"
            class="compat-item"
            :class="{ 'compat-item--lg': logo.scale === 'lg' }"
          >
            <img
              :src="logo.src"
              :alt="logo.name"
              class="compat-logo"
              width="120"
              height="40"
              decoding="async"
              :loading="i >= compatLogos.length ? 'lazy' : 'eager'"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- Trust strip -->
    <section class="trust-strip" aria-label="Implementation metrics">
      <div class="trust-grid">
        <div v-for="stat in trustStats" :key="stat.label" class="trust-stat">
          <p class="trust-num">{{ stat.value }}</p>
          <p class="trust-label">{{ stat.label }}</p>
        </div>
      </div>
    </section>

    <!-- Math / Proof — split + bento -->
    <section id="math" class="py-20 sm:py-24">
      <div class="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-12 lg:gap-14 lg:items-center">
        <div class="lg:col-span-5">
          <p class="label mb-3">The math</p>
          <h2
            class="font-display text-3xl font-semibold leading-[1.15] tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
          >
            Keep devices dumb and deterministic.
          </h2>
          <p class="landing-body mt-5">
            For intermittent, bandwidth-constrained, battery-powered telemetry, maintaining
            heavyweight application/session semantics on the edge can add unnecessary radio time,
            bytes, and implementation complexity. Struct ships the packed C++ layout your firmware
            already has.
          </p>
          <p class="mt-6 font-mono text-[11px] text-[#8B93A7]">
            Cold-uplink comparison · fixed-memory packing · UDP or TCP
          </p>
        </div>

        <div class="grid gap-3 lg:col-span-7">
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
                  <span
                    class="metric-num"
                    :class="{ 'metric-num--pending': card.pending }"
                  >{{ card.winLead }}</span>
                  <span v-if="card.winTail" class="metric-tail">{{ card.winTail }}</span>
                </p>
                <p class="landing-note mt-2">{{ card.winNote }}</p>
                <p v-if="card.roiNote" class="landing-note mt-2">
                  {{ card.roiNote }}
                </p>
              </div>
              <div class="text-right">
                <p
                  class="font-mono text-sm text-[#5A6275]"
                  :class="{ 'line-through decoration-[#5A6275]/80': !card.pending }"
                >
                  {{ card.lose }}
                </p>
                <p class="mt-0.5 font-mono text-[10px] text-[#5A6275]">{{ card.loseNote }}</p>
              </div>
            </div>
          </article>
          <p class="landing-note mt-2 text-[#8B93A7]">
            Battery-life improvement depends on radio/modem type, signal quality, transmission
            frequency, retries, sleep current, battery chemistry and capacity, temperature, and
            firmware behavior. Persistent HTTPS/TLS and persistent MQTT connections may have
            substantially lower per-message overhead than a cold connection.
          </p>
        </div>
      </div>
    </section>

    <!-- Instant Code sandbox -->
    <section id="sandbox" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto grid max-w-6xl items-start gap-10 px-6 lg:grid-cols-12 lg:gap-12">
        <div class="lg:col-span-5">
          <p class="label mb-3">Instant code</p>
          <h2
            class="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
          >
            Type three fields.
            <span class="text-[#38B6FF]">Get the struct.</span>
          </h2>
          <p class="landing-body mt-5">
            No account required. Define your payload, see the packed C++ layout, then start free
            to get your ingest endpoint.
          </p>
          <NuxtLink to="/signup" class="btn-primary mt-8 inline-flex px-6 py-3 text-sm">
            Start Free
          </NuxtLink>
        </div>

        <div class="sandbox-window lg:col-span-7" aria-label="Interactive C++ struct sandbox">
          <div class="sandbox-topbar">
            <div class="flex items-center gap-2">
              <span class="dot dot-r" />
              <span class="dot dot-y" />
              <span class="dot dot-g" />
            </div>
            <span class="font-mono text-[10px] text-[#5A6275]">schema sandbox</span>
            <span class="sandbox-badge">LIVE</span>
          </div>

          <div class="sandbox-body">
            <div class="sandbox-fields">
              <p class="debug-label">Fields</p>
              <div
                v-for="(field, idx) in sandboxFields"
                :key="idx"
                class="sandbox-row"
              >
                <input
                  v-model="field.name"
                  type="text"
                  class="sandbox-input"
                  :aria-label="`Field ${idx + 1} name`"
                  autocomplete="off"
                  spellcheck="false"
                />
                <select
                  v-model="field.type"
                  class="sandbox-select"
                  :aria-label="`Field ${idx + 1} type`"
                >
                  <option
                    v-for="opt in sandboxTypeOptions"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </option>
                </select>
              </div>
            </div>

            <div class="sandbox-preview">
              <div class="flex items-center justify-between gap-3">
                <p class="debug-label mb-0">C++ preview</p>
                <button
                  type="button"
                  class="btn-ghost px-3 py-1 text-[10px]"
                  @click="copySandboxCode"
                >
                  {{ sandboxCopied ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <pre class="sandbox-code font-mono">{{ sandboxCpp }}</pre>
            </div>
          </div>
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
              Up to 99% less transmitted data per cold uplink.
              <span class="text-[#38B6FF]">Modeled ~$2,400/mo at fleet scale.</span>
            </h2>
            <p class="landing-body mt-5">
              In our cold-uplink comparison, a small authenticated Struct UDP frame is ~100&nbsp;bytes
              versus ~5.2&nbsp;KB for a cold HTTPS/TLS telemetry request. That difference is mostly
              session and handshake overhead, not “JSON vs packed struct” in isolation. Persistent
              HTTPS/TLS and persistent MQTT connections may have substantially lower per-message
              overhead than a cold connection.
            </p>
            <div class="mt-7 flex flex-wrap gap-2">
              <span class="signal-chip">LTE-M</span>
              <span class="signal-chip">NB-IoT</span>
              <span class="signal-chip">Satellite</span>
              <span class="signal-chip">Metered SIMs</span>
            </div>
            <NuxtLink to="/benchmarks" class="btn-ghost mt-6 inline-flex px-5 py-2.5 text-xs">
              View benchmark methodology
            </NuxtLink>
          </div>

          <div class="bandwidth-meter" aria-label="Cold-uplink bandwidth comparison">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="font-mono text-[10px] uppercase tracking-[0.15em] text-[#8B93A7]">
                  10k devices · 1 ping/min · cold HTTPS model
                </p>
                <p class="bandwidth-savings">
                  ~$2,400
                </p>
                <p class="mt-1 text-xs text-[#8B93A7]">modeled monthly SIM savings · ~2.2 TB less data</p>
              </div>
              <div class="savings-ring savings-ring--99">
                <span class="font-display text-xl font-semibold text-[#F4F5F7]">99%</span>
                <span class="font-mono text-[8px] uppercase tracking-wider text-[#8B93A7]">less data</span>
              </div>
            </div>

            <div class="mt-8 space-y-5">
              <div>
                <div class="mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1 font-mono text-[10px]">
                  <span class="text-[#8B93A7]">HTTPS POST + TLS cold-start</span>
                  <span class="text-[#E8EAEF]">~5,200 bytes</span>
                </div>
                <div class="meter-track"><span class="meter-json" /></div>
              </div>
              <div>
                <div class="mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1 font-mono text-[10px]">
                  <span class="text-[#8B93A7]">Authenticated Struct UDP frame</span>
                  <span class="text-[#38B6FF]">~100 bytes</span>
                </div>
                <div class="meter-track"><span class="meter-struct meter-struct--udp" /></div>
              </div>
            </div>
            <p class="mt-6 text-[10px] leading-relaxed text-[#5A6275]">
              Model, not a measured bill: 10,000 devices, one cold uplink per minute, ~5,100 bytes
              saved per ping, $1.10/GB. This does not apply to keep-alive MQTT or reused TLS sessions.
              See
              <NuxtLink to="/benchmarks" class="text-[#8B93A7] underline decoration-[#2A2F3A] underline-offset-2 hover:text-[#38B6FF]">
                methodology
              </NuxtLink>.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Encoding comparison -->
    <section id="compare" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div class="max-w-2xl">
            <p class="label mb-3">Comparison</p>
            <h2
              class="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
            >
              Fair against the encodings you already use.
            </h2>
            <p class="landing-body mt-4">
              Numeric cells without a repository measurement are marked
              <span class="font-mono text-[#E8EAEF]">Benchmark pending</span>.
              Protobuf, CBOR, and MessagePack remain strong choices for many workloads.
            </p>
          </div>
          <NuxtLink to="/benchmarks" class="btn-ghost inline-flex shrink-0 px-5 py-2.5 text-xs">
            View benchmark methodology
          </NuxtLink>
        </div>

        <div class="compare-wrap" role="region" aria-label="Encoding comparison matrix" tabindex="0">
          <table class="compare-table">
            <thead>
              <tr>
                <th scope="col">Stack</th>
                <th scope="col">Encoding format</th>
                <th scope="col">Payload size</th>
                <th scope="col">Connection / session</th>
                <th scope="col">Device memory</th>
                <th scope="col">Serialization model</th>
                <th scope="col">Best-fit workload</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in compareRows" :key="row.stack">
                <th scope="row">{{ row.stack }}</th>
                <td>{{ row.encoding }}</td>
                <td :class="{ 'compare-pending': row.payloadPending }">{{ row.payload }}</td>
                <td>{{ row.session }}</td>
                <td>{{ row.memory }}</td>
                <td>{{ row.model }}</td>
                <td>{{ row.fit }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="landing-note mt-4 text-[#8B93A7]">
          CBOR, MessagePack, Protobuf, and warm MQTT sizes are not measured in this repository yet.
          Advantages of those stacks are listed in the
          <NuxtLink to="/benchmarks" class="underline decoration-[#2A2F3A] underline-offset-2 hover:text-[#38B6FF]">
            methodology
          </NuxtLink>.
        </p>
      </div>
    </section>

    <!-- When Struct is not the right fit -->
    <section id="fit" class="border-t border-[#2A2F3A] py-16 sm:py-20">
      <div class="mx-auto max-w-3xl px-6">
        <p class="label mb-3">Scope</p>
        <h2
          class="font-display text-2xl font-semibold leading-[1.15] tracking-[-0.03em] text-[#F4F5F7] sm:text-3xl"
        >
          When Struct is not the right fit
        </h2>
        <ul class="fit-list mt-6">
          <li>You need arbitrary or frequently changing dynamic payloads.</li>
          <li>
            You already use Protobuf or CBOR successfully over a persistent connection and
            bandwidth is not a meaningful constraint.
          </li>
          <li>Your device is mains-powered and radio/data costs are insignificant.</li>
          <li>Your workload is primarily request/response rather than intermittent telemetry.</li>
          <li>You require a long-lived bidirectional stream for most communication.</li>
        </ul>
        <p class="landing-body mt-6">
          Struct is designed primarily for intermittent, bandwidth-constrained, battery-powered
          telemetry where keeping the edge simple and deterministic matters.
        </p>
      </div>
    </section>

    <!-- Architecture with packet motion -->
    <section id="architecture" class="border-t border-[#2A2F3A] py-20 sm:py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-10 text-center">
          <p class="label mb-2 text-center">Architecture</p>
          <h2
            class="font-display text-3xl font-semibold tracking-[-0.03em] text-[#F4F5F7] sm:text-4xl"
          >
            You're the edge. We're the middleman.
          </h2>
          <p class="landing-body mx-auto mt-4 max-w-2xl">
            Keep devices dumb and deterministic. The device sends the smallest deterministic packet
            it reasonably can. Struct handles authentication, parsing, schema interpretation,
            routing, and cloud-friendly conversion. Existing cloud systems receive usable structured
            data.
          </p>
        </div>

        <div class="arch-callout mb-14">
          <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-[#38B6FF]">
            Per-frame auth. No TLS handshake on the UDP path.
          </p>
          <p class="landing-body mt-2">
            UDP carries one authenticated datagram and returns the radio to sleep. TCP remains
            available when you need a stream; UDP is the battery path. Struct supports the
            transport that matches the workload rather than replacing TCP or MQTT everywhere.
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
              Pack a fixed C struct and send the smallest deterministic frame the schema allows.
              <span class="font-mono text-[#38B6FF]">UDP for intermittent uplinks</span>; TCP when
              you need a stream.
            </p>
          </div>
          <div class="arch-gap" aria-hidden="true">
            <span class="arch-gap-line" />
            <span class="font-mono text-[10px] text-[#5A6275]">UDP</span>
          </div>
          <div class="arch-node arch-node--accent">
            <div class="arch-glyph text-[#38B6FF]">02</div>
            <h3 class="arch-title">Struct Gateway</h3>
            <p class="arch-body">
              Authenticates each frame, optionally decrypts ChaCha20-Poly1305, interprets the
              schema version, and converts to structured JSON for routing.
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
              HTTPS webhooks deliver parsed JSON to systems you already run —
              <span class="text-[#E8EAEF]">custom backends</span>,
              <span class="text-[#E8EAEF]">AWS IoT HTTP</span>, or similar ingest URLs.
            </p>
          </div>
        </div>

        <!-- Mobile stack -->
        <div class="flex flex-col gap-3 lg:hidden">
          <div class="arch-node">
            <div class="arch-glyph">01 · Edge</div>
            <h3 class="arch-title">Dumb Edge Device</h3>
            <p class="arch-body">
              Sends the smallest deterministic packet it reasonably can, then sleeps.
            </p>
          </div>
          <div class="arch-gap-m" aria-hidden="true">
            <span class="arch-gap-line-m" />
          </div>
          <div class="arch-node arch-node--accent">
            <div class="arch-glyph text-[#38B6FF]">02 · Gateway</div>
            <h3 class="arch-title">Struct Gateway</h3>
            <p class="arch-body">Authenticate · parse · convert · route.</p>
          </div>
          <div class="arch-gap-m" aria-hidden="true">
            <span class="arch-gap-line-m" />
          </div>
          <div class="arch-node">
            <div class="arch-glyph">03 · Cloud</div>
            <h3 class="arch-title">Enterprise Cloud</h3>
            <p class="arch-body">HTTPS webhooks to your existing systems.</p>
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
            Binary shouldn't mean blind.
          </h2>
          <p class="landing-body mt-5">
            Build a test frame from your real schema and inspect the exact wire bytes beside the
            decoded JSON—without powering a device or sending traffic.
          </p>
          <ul class="landing-note mt-7 space-y-3">
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
          <p class="landing-body max-w-md">
            Protect data in motion, reject replayed packets, isolate every organization, and keep a
            durable record of infrastructure changes.
          </p>
        </div>

        <div class="mt-6 flex items-start gap-3 rounded-lg border border-[#38B6FF]/20 bg-[#38B6FF]/5 p-4">
          <span class="mt-0.5 font-mono text-xs text-[#38B6FF]">✓</span>
          <p class="landing-note">
            <strong class="font-semibold text-[#E8EAEF]">API secrets stay off the wire:</strong>
            Devices authenticate with HMAC-SHA256 over the frame body. The API secret is not
            transmitted; only a public key_id is sent.
          </p>
        </div>

        <div class="security-grid mt-12">
          <article class="security-card security-card--wide">
            <div class="security-icon">ENC</div>
            <p class="security-kicker">Payload protection</p>
            <h3 class="security-title">ChaCha20-Poly1305 encryption</h3>
            <p class="security-copy">
              Optional on Pro and Scale. Authenticated encryption protects telemetry confidentiality
              and integrity on constrained MCUs. Timestamp checks and nonce tracking reject stale or
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
              Scale plan: append-only, diff-based history of who changed a device, schema, or
              routing destination, and when. Database triggers reject updates and deletes.
            </p>
          </article>

          <article class="security-card">
            <div class="security-icon">CMD</div>
            <p class="security-kicker">Controlled operations</p>
            <h3 class="security-title">Typed command downlinks</h3>
            <p class="security-copy">
              Pro and Scale: queue interval changes, reboots, or custom byte commands through
              authenticated device records instead of a second control plane.
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
          <p class="landing-body mx-auto mt-4 max-w-xl">
            Every plan includes the binary telemetry gateway, dashboard, and live debugger.
            Upgrade when the included-device math is cheaper than paying per device.
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
            <p class="landing-note mt-3 min-h-10">
              {{ plan.description }}
            </p>
            <p class="mt-5 border-t border-[#2A2F3A] pt-5 font-mono text-xs text-[#E8EAEF]">
              {{ plan.devices }}
            </p>
            <p v-if="plan.bestFor" class="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B93A7]">
              {{ plan.bestFor }}
            </p>
            <p v-if="plan.deviceRate" class="mt-2 font-mono text-xs text-[#38B6FF]">
              {{ plan.deviceRate }}
            </p>
            <p v-if="plan.crossover" class="mt-2 text-[11px] leading-snug text-[#5A6275]">
              {{ plan.crossover }}
            </p>
            <ul class="landing-note mt-5 flex-1 space-y-2.5">
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
        <p class="landing-body mt-4">
          Create a free device, drop in the generated C++ header, and watch live telemetry land.
          Destinations and fleet tags are included; ChaCha20 and downlinks start on Pro.
        </p>
        <NuxtLink to="/signup" class="btn-primary mt-8 inline-flex px-8 py-3.5">
          Start free — get your API key
        </NuxtLink>
      </div>
    </section>

    <footer class="site-footer">
      <div class="site-footer-inner">
        <div class="footer-grid">
          <div class="footer-brand">
            <NuxtLink to="/" class="footer-logo" aria-label="Struct home">
              <StructLogo size="md" />
            </NuxtLink>
            <p class="footer-tagline">Binary telemetry gateway for the edge.</p>
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
            <h3 class="footer-heading">Product</h3>
            <ul class="footer-links">
              <li><NuxtLink to="/dashboard/schema">Schema Builder</NuxtLink></li>
              <li><NuxtLink to="/dashboard/devices">Uplink Management</NuxtLink></li>
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
            <h3 class="footer-heading">Developers</h3>
            <ul class="footer-links">
              <li>
                <a
                  href="https://github.com/CEMAMI09/Struct#readme"
                  target="_blank"
                  rel="noopener noreferrer"
                >Documentation</a>
              </li>
              <li><NuxtLink to="/benchmarks">Benchmark methodology</NuxtLink></li>
              <li>
                <a
                  href="https://github.com/CEMAMI09/Struct#readme"
                  target="_blank"
                  rel="noopener noreferrer"
                >API Reference</a>
              </li>
              <li>
                <a
                  href="https://github.com/CEMAMI09/Struct#readme"
                  target="_blank"
                  rel="noopener noreferrer"
                >Supported Hardware</a>
              </li>
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
            <h3 class="footer-heading">Legal &amp; Company</h3>
            <ul class="footer-links">
              <li>
                <a href="mailto:sales@struct.dev?subject=Struct inquiry">Contact Us</a>
              </li>
              <li><NuxtLink to="/privacy">Privacy Policy</NuxtLink></li>
              <li><NuxtLink to="/terms">Terms of Service</NuxtLink></li>
            </ul>
          </div>
        </div>

        <div class="footer-bottom">
          <p class="font-mono text-[11px] text-[#5A6275]">
            © {{ new Date().getFullYear() }} Struct. All rights reserved.
          </p>
          <NuxtLink to="/login" class="footer-signin">Sign in</NuxtLink>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import type { ScalarFieldType, SchemaField } from '~/types'

definePageMeta({ layout: false })

const user = useSupabaseUser()
const { cppPreview, schemaByteLength } = useCppHeader()

useSeoMeta({
  title: 'Struct — Deterministic binary telemetry for the edge',
  description:
    'Keep devices dumb and deterministic. Send packed C structs over UDP or TCP; Struct authenticates, parses, and converts to structured JSON for your cloud.',
})

const menuOpen = ref(false)
let sandboxCopyTimer: ReturnType<typeof setTimeout> | null = null

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
    // Wait for leave + enter (mode="out-in")
    await delay(HERO_FADE_MS * 2)
  }
}

function onResizeCloseMenu() {
  if (window.innerWidth >= 1024) menuOpen.value = false
}

onMounted(() => {
  window.addEventListener('resize', onResizeCloseMenu)
  // Decorative: keep running under prefers-reduced-motion; CSS softens transitions.
  runHeroCarousel()
})

onBeforeUnmount(() => {
  heroCarouselStopped = true
  window.removeEventListener('resize', onResizeCloseMenu)
  if (heroWordTimer) clearTimeout(heroWordTimer)
  if (sandboxCopyTimer) clearTimeout(sandboxCopyTimer)
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

const trustStats = [
  { value: '~100 B', label: 'Authenticated example uplink' },
  { value: '0', label: 'Heap allocs in packing path' },
  { value: '5', label: 'Packed field types' },
]

const mathCards: {
  label: string
  winLead: string
  winTail: string
  winNote: string
  lose: string
  loseNote: string
  roiNote?: string
  pending?: boolean
}[] = [
  {
    label: 'Cold-uplink data',
    winLead: '99%',
    winTail: 'less data',
    winNote:
      '99% less transmitted data in our cold-uplink benchmark: ~100 B authenticated UDP vs ~5.2 KB cold HTTPS/TLS.',
    lose: '~5.2 KB',
    loseNote: 'cold HTTPS example',
  },
  {
    label: 'Radio awake time',
    winLead: 'UDP',
    winTail: 'one datagram',
    winNote:
      'No TLS or TCP handshake on the battery path. Radio-on time is not yet measured as a multiplier.',
    lose: 'Cold TLS',
    loseNote: 'handshake + request',
    roiNote:
      'Shorter uplinks can materially reduce radio energy use on battery-powered devices.',
  },
  {
    label: 'Heap allocations',
    winLead: '0',
    winTail: '',
    winNote:
      'Fixed-memory serialization with no dynamic allocation in the Struct packing path.',
    lose: 'Varies',
    loseNote: 'on-device JSON parsers',
  },
]

/*
 * TODO(benchmarks): replace payloadPending cells with measured encodings of the
 * shared sample schema (temp float32, humidity float32, is_active uint8) for
 * CBOR, MessagePack, Protobuf, JSON+MQTT, and JSON+HTTPS. Do not invent sizes.
 */
const compareRows = [
  {
    stack: 'JSON + HTTPS',
    encoding: 'JSON text',
    payload: '~5.2 KB cold uplink (TLS+HTTP); JSON body is much smaller',
    payloadPending: false,
    session: 'TLS + HTTP per cold request; reused sessions are much cheaper',
    memory: 'Typically a JSON parser/buffer on device',
    model: 'Self-describing text',
    fit: 'Request/response and internet APIs',
  },
  {
    stack: 'JSON + MQTT/TLS',
    encoding: 'JSON text',
    payload: 'Benchmark pending',
    payloadPending: true,
    session: 'Persistent MQTT session; per-message overhead drops after connect',
    memory: 'MQTT client + JSON parser',
    model: 'Self-describing text over a session',
    fit: 'Connected devices that stay online',
  },
  {
    stack: 'CBOR + MQTT',
    encoding: 'CBOR',
    payload: 'Benchmark pending',
    payloadPending: true,
    session: 'Persistent MQTT; compact binary once connected',
    memory: 'Often a small static or streaming encoder',
    model: 'Self-describing binary — no out-of-band schema required',
    fit: 'Constrained devices that still need flexible payloads',
  },
  {
    stack: 'MessagePack',
    encoding: 'MessagePack',
    payload: 'Benchmark pending',
    payloadPending: true,
    session: 'Transport-dependent',
    memory: 'Often a small encoder/decoder',
    model: 'Self-describing binary, JSON-like types',
    fit: 'Compact interchange when a schema registry is unavailable',
  },
  {
    stack: 'Protobuf',
    encoding: 'Protocol Buffers',
    payload: 'Benchmark pending',
    payloadPending: true,
    session: 'Transport-dependent; schema on both ends',
    memory: 'Generated code; typically no JSON parser',
    model: 'Schema-driven TLV — strong evolution and multi-language codegen',
    fit: 'Evolving, nested, polyglot service payloads',
  },
  {
    stack: 'Struct',
    encoding: 'Packed C struct + Protocol v2',
    payload: '75 B frame (9 B payload + 66 B v2); ~100 B rounded example',
    payloadPending: false,
    session: 'UDP: no app session. TCP stream available when needed',
    memory: '0 heap allocs in the generated packing path',
    model: 'Fixed little-endian layout; schema lives in the gateway',
    fit: 'Intermittent, battery-powered telemetry',
  },
]

type SandboxField = { name: string; type: ScalarFieldType }

const sandboxTypeOptions: { value: ScalarFieldType; label: string }[] = [
  { value: 'float32', label: 'float' },
  { value: 'int32', label: 'int32' },
  { value: 'uint8', label: 'uint8' },
  { value: 'boolean', label: 'boolean' },
]

const sandboxFields = ref<SandboxField[]>([
  { name: 'temp', type: 'float32' },
  { name: 'humidity', type: 'uint8' },
  { name: 'battery', type: 'uint8' },
])

const sandboxCopied = ref(false)

const sandboxSchemaFields = computed<SchemaField[]>(() =>
  sandboxFields.value.map((f) => ({
    name: f.name.trim() || 'unnamed',
    type: f.type,
  })),
)

const sandboxCpp = computed(() =>
  cppPreview(sandboxSchemaFields.value, 1, schemaByteLength(sandboxSchemaFields.value)),
)

async function copySandboxCode() {
  try {
    await navigator.clipboard.writeText(sandboxCpp.value)
    sandboxCopied.value = true
    if (sandboxCopyTimer) clearTimeout(sandboxCopyTimer)
    sandboxCopyTimer = setTimeout(() => {
      sandboxCopied.value = false
    }, 1600)
  } catch {
    sandboxCopied.value = false
  }
}

const pricingPlans = [
  {
    name: 'Free (Developer)',
    price: '$0',
    interval: 'forever',
    description: 'Build, connect, and validate your first edge fleet.',
    devices: 'Up to 5 devices',
    bestFor: 'Best for 1–5 devices',
    deviceRate: '',
    crossover: '',
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
    bestFor: 'Best for 5–49 devices',
    deviceRate: '',
    crossover: 'Equals Pro at 49 devices ($49). Pro is cheaper from 50.',
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
    devices: 'Includes 150 devices',
    bestFor: 'Best for 50–549 devices',
    deviceRate: '$0.50 per extra device / month',
    crossover: 'Cheaper than Flexible from 50 devices. Equals Scale at 550 ($249).',
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
    devices: 'Includes 1,000 devices',
    bestFor: 'Best for 550+ devices',
    deviceRate: '$0.20 per extra device / month',
    crossover: 'Same $249 as Pro at 550 devices, with 1,000 included. Cheaper above 550.',
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
    bestFor: '',
    deviceRate: '',
    crossover: '',
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
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1.0625rem;
  line-height: 1.65;
  overflow-x: clip;
  width: 100%;
}

.font-display {
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
}

.landing-body {
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1.125rem;
  font-weight: 400;
  line-height: 1.7;
  color: #b4bcc9;
}

.landing-note {
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.65;
  color: #b4bcc9;
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

.nav {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  height: 4.25rem;
  padding: 0 max(1rem, env(safe-area-inset-right)) 0 max(1rem, env(safe-area-inset-left));
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

.mobile-menu-signin {
  color: #a8b2c4 !important;
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 3rem 0 3.25rem;
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
  gap: 2rem;
  align-items: center;
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
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
}

@media (min-width: 1024px) {
  .hero-copy {
    margin-left: -1rem;
  }
}

.hero-title {
  margin: 0;
  max-width: 32rem;
  font-size: clamp(1.65rem, 6.2vw, 3.15rem);
  font-weight: 650;
  line-height: 1.12;
  letter-spacing: -0.035em;
  color: #f4f5f7;
  overflow-wrap: anywhere;
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
  margin: 1.1rem 0 0;
  max-width: 32rem;
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1.125rem;
  font-weight: 400;
  line-height: 1.7;
  color: #b4bcc9;
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
  min-width: 0;
  min-height: 0;
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
    transform: translate(2.75rem, -50%) scale(0.95);
    transform-origin: left center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-word-enter-active,
  .hero-word-leave-active {
    transition: opacity 0.35s ease;
  }

  .hero-word-enter-from,
  .hero-word-leave-to {
    opacity: 0;
    transform: none;
  }

  .cursor {
    animation: none;
    opacity: 1;
  }

  @media (min-width: 1024px) {
    .hero-shot {
      transform: translate(2.75rem, -50%) scale(0.95);
    }
  }
}

/* Glass terminal (sandbox / debugger) */
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

/* Compatible with — logo marquee */
.compat {
  padding: 1.25rem 0 2.75rem;
  border-top: 1px solid #2a2f3a;
  background: #0f1115;
}

@media (min-width: 640px) {
  .compat {
    padding: 1.5rem 0 3.75rem;
  }
}

.compat-label {
  margin: 0 0 1.5rem;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8b93a7;
}

.compat-marquee {
  overflow: hidden;
  mask-image: linear-gradient(
    90deg,
    transparent 0%,
    #000 8%,
    #000 92%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    90deg,
    transparent 0%,
    #000 8%,
    #000 92%,
    transparent 100%
  );
}

.compat-track {
  display: flex;
  width: max-content;
  gap: 2.25rem;
  align-items: center;
  padding-left: 2.25rem;
  animation: compat-scroll 40s linear infinite;
}

@media (min-width: 640px) {
  .compat-track {
    gap: 3.5rem;
    padding-left: 3.5rem;
  }
}

.compat-item {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 5.75rem;
  height: 2.25rem;
}

@media (min-width: 640px) {
  .compat-item {
    width: 7.5rem;
    height: 2.75rem;
  }
}

.compat-item--lg {
  width: 7rem;
  height: 2.75rem;
}

@media (min-width: 640px) {
  .compat-item--lg {
    width: 9.25rem;
    height: 3.5rem;
  }
}

.compat-logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  opacity: 0.85;
}

@keyframes compat-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  /* Still scroll, but slower — static wrap looked broken on marketing pages. */
  .compat-track {
    animation-duration: 80s;
  }
}

/* Trust strip */
.trust-strip {
  background: #0f1115;
  border-bottom: 1px solid #2a2f3a;
}

.trust-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
  max-width: 72rem;
  margin: 0 auto;
  padding: 2.25rem max(1rem, env(safe-area-inset-right)) 3rem max(1rem, env(safe-area-inset-left));
}

@media (min-width: 640px) {
  .trust-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.5rem;
    padding: 3rem 1.5rem 4.25rem;
  }
}

.trust-stat {
  text-align: center;
}

@media (min-width: 640px) {
  .trust-stat:not(:last-child) {
    border-right: 1px solid #2a2f3a;
  }
}

.trust-num {
  margin: 0;
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(2.35rem, 4.5vw, 3.25rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
  color: #38b6ff;
}

.trust-label {
  margin: 0.55rem 0 0;
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: #8b93a7;
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
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(2.25rem, 4vw, 3rem);
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1;
  color: #38b6ff;
}

.metric-tail {
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1.05rem;
  font-weight: 500;
  line-height: 1.2;
  color: #a8b2c4;
}

.metric-num--pending {
  font-size: clamp(1.75rem, 3vw, 2.25rem);
  color: #8b93a7;
}

/* Instant Code sandbox */
.sandbox-window {
  overflow: hidden;
  border: 1px solid #343a47;
  border-radius: 16px;
  background: #111319;
  box-shadow:
    0 40px 80px -42px rgba(0, 0, 0, 0.9),
    0 0 0 1px rgba(255, 255, 255, 0.025) inset;
}

.sandbox-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid #2a2f3a;
  padding: 0.7rem 1rem;
  background: #15181e;
}

.sandbox-badge {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  color: #38b6ff;
}

.sandbox-body {
  display: grid;
  gap: 0;
}

@media (min-width: 720px) {
  .sandbox-body {
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  }
}

.sandbox-fields,
.sandbox-preview {
  padding: 1.1rem 1.15rem 1.25rem;
}

.sandbox-fields {
  border-bottom: 1px solid #2a2f3a;
}

@media (min-width: 720px) {
  .sandbox-fields {
    border-bottom: none;
    border-right: 1px solid #2a2f3a;
  }
}

.sandbox-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(5.5rem, 6.5rem);
  gap: 0.5rem;
  margin-top: 0.55rem;
}

.sandbox-input,
.sandbox-select {
  min-width: 0;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  background: #0f1115;
  padding: 0.55rem 0.65rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: #e8eaef;
  outline: none;
}

.sandbox-input:focus,
.sandbox-select:focus {
  border-color: rgba(56, 182, 255, 0.55);
}

.sandbox-select {
  color: #38b6ff;
}

.sandbox-code {
  margin-top: 0.65rem;
  overflow-x: auto;
  border-radius: 10px;
  background: #0f1115;
  padding: 0.85rem 0.9rem;
  font-size: 11px;
  line-height: 1.55;
  color: #38b6ff;
  white-space: pre;
}

.arch-callout {
  max-width: 40rem;
  margin-left: auto;
  margin-right: auto;
  border: 1px solid rgba(56, 182, 255, 0.22);
  border-radius: 14px;
  background: rgba(56, 182, 255, 0.05);
  padding: 1.1rem 1.25rem;
  text-align: left;
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
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  @apply text-base font-semibold tracking-tight text-[#E8EAEF];
}

.arch-body {
  margin-top: 0.5rem;
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1rem;
  line-height: 1.65;
  color: #b4bcc9;
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
  padding: 1.15rem;
  background: rgba(15, 17, 21, 0.82);
  box-shadow: 0 28px 60px -36px rgba(56, 182, 255, 0.5);
}

@media (min-width: 640px) {
  .bandwidth-meter {
    padding: 1.5rem;
  }
}

.bandwidth-savings {
  margin-top: 0.5rem;
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(1.85rem, 7vw, 2.25rem);
  font-weight: 600;
  letter-spacing: -0.04em;
  color: #38b6ff;
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

.savings-ring--99 {
  background:
    radial-gradient(circle, #151b22 58%, transparent 60%),
    conic-gradient(#38b6ff 0 99%, #2a2f3a 99% 100%);
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

.meter-struct--udp {
  width: 2%;
  min-width: 6px;
}

/* Encoding comparison */
.compare-wrap {
  overflow-x: auto;
  border: 1px solid #2a2f3a;
  border-radius: 14px;
  background: #15181e;
  -webkit-overflow-scrolling: touch;
}

.compare-table {
  width: 100%;
  min-width: 58rem;
  border-collapse: collapse;
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.5;
}

.compare-table th,
.compare-table td {
  padding: 0.85rem 0.9rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid #2a2f3a;
}

.compare-table thead th {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8b93a7;
  background: #111319;
  white-space: nowrap;
}

.compare-table tbody th {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  color: #e8eaef;
  white-space: nowrap;
}

.compare-table td {
  color: #b4bcc9;
}

.compare-table tbody tr:last-child th,
.compare-table tbody tr:last-child td {
  border-bottom: 0;
  background: rgba(56, 182, 255, 0.04);
}

.compare-table tbody tr:last-child th {
  color: #38b6ff;
}

.compare-pending {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: #a8b2c4;
}

.fit-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.fit-list li {
  position: relative;
  padding: 0.7rem 0 0.7rem 1.15rem;
  border-bottom: 1px solid #2a2f3a;
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1.0625rem;
  line-height: 1.65;
  color: #b4bcc9;
}

.fit-list li::before {
  content: '–';
  position: absolute;
  left: 0;
  color: #5a6275;
}

.fit-list li:last-child {
  border-bottom: 0;
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
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
  border-bottom: 1px solid #2a2f3a;
  padding: 0.75rem 0.85rem;
  background: #181b22;
}

.debug-topbar > .font-mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font-size: 9px;
}

@media (min-width: 480px) {
  .debug-topbar {
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    padding: 0.75rem 1rem;
  }

  .debug-topbar > .font-mono {
    font-size: 10px;
  }
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
  gap: 0.45rem;
  align-items: center;
  padding: 0.65rem 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
}

@media (max-width: 379px) {
  .debug-field {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .debug-field em {
    display: none;
  }
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
  padding: 1.15rem;
  background: #1a1d24;
}

@media (min-width: 640px) {
  .security-card {
    padding: 1.5rem;
  }
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
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #e8eaef;
}

.security-copy {
  margin-top: 0.75rem;
  max-width: 48rem;
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  font-size: 1rem;
  line-height: 1.65;
  color: #b4bcc9;
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
  padding: 1.35rem 1.25rem 1.5rem;
}

@media (min-width: 640px) {
  .pricing-card {
    padding: 2rem;
  }
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

@media (min-width: 900px) {
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

@media (min-width: 900px) and (max-width: 1099px) {
  .pricing-grid .pricing-card {
    min-height: 0;
    padding: 1.5rem 1.25rem;
  }

  .pricing-card--featured {
    transform: translateY(-0.75rem);
  }
}

/* Footer */
.site-footer {
  border-top: 1px solid #2a2f3a;
  padding: 3rem 0 max(2rem, env(safe-area-inset-bottom));
}

.site-footer-inner {
  margin-inline: auto;
  max-width: 72rem;
  padding-inline: max(1rem, env(safe-area-inset-left)) max(1rem, env(safe-area-inset-right));
}

.footer-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2.5rem;
}

@media (min-width: 640px) {
  .footer-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2.5rem 2rem;
  }
}

@media (min-width: 1024px) {
  .footer-grid {
    grid-template-columns: 1.35fr repeat(3, minmax(0, 1fr));
    gap: 3rem;
  }
}

.footer-brand {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.85rem;
  max-width: 16rem;
}

.footer-logo :deep(.struct-logo) {
  margin-inline: 0;
  height: 2.25rem;
  width: auto;
}

.footer-tagline {
  margin: 0;
  font-size: 1rem;
  line-height: 1.55;
  color: #b4bcc9;
}

.footer-status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: #8b93a7;
  transition: color 0.15s ease;
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
  animation: status-pulse 2.4s ease-in-out infinite;
}

@keyframes status-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px rgba(40, 200, 64, 0.18);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(40, 200, 64, 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .footer-status-dot {
    animation: none;
  }
}

.footer-heading {
  margin: 0 0 1rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f4f5f7;
}

.footer-links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.footer-links a {
  font-size: 0.9375rem;
  color: #b4bcc9;
  transition: color 0.15s ease;
}

.footer-links a:hover {
  color: #38b6ff;
}

.footer-bottom {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid #2a2f3a;
}

@media (min-width: 640px) {
  .footer-bottom {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.footer-signin {
  font-size: 0.75rem;
  color: #8b93a7;
  transition: color 0.15s ease;
}

.footer-signin:hover {
  color: #38b6ff;
}

</style>

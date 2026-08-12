<template>
  <div class="method">
    <header class="method-nav">
      <NuxtLink to="/" class="nav-logo" aria-label="Struct home">
        <StructLogo size="md" />
      </NuxtLink>
      <NuxtLink to="/#compare" class="btn-ghost text-xs">Back to comparison</NuxtLink>
    </header>

    <main class="method-main">
      <p class="label mb-3">Methodology</p>
      <h1 class="method-title">Benchmark methodology</h1>
      <p class="method-lede">
        Claims on the landing page are either calculated from Protocol v2, tied to the cold-uplink
        comparison below, or labeled pending. This page is the source of those conditions.
      </p>

      <section class="method-section">
        <h2>Sample telemetry schema</h2>
        <p>
          Reference payload used for size calculations matches
          <span class="mono">dummy-device.js</span> and
          <span class="mono">test_device.cpp</span>:
        </p>
        <pre class="method-pre">{
  "temp": 22.5,        // float32, 4 bytes
  "humidity": 40.0,    // float32, 4 bytes
  "is_active": true    // uint8 boolean, 1 byte
}</pre>
        <p>Packed little-endian payload: <strong>9 bytes</strong>.</p>
      </section>

      <section class="method-section">
        <h2>Struct encoded frame</h2>
        <p>Protocol v2 telemetry uplink:</p>
        <pre class="method-pre">[1B proto=2][16B key_id][1B schema][4B unix_ts][12B nonce][payload][32B HMAC-SHA256]</pre>
        <ul>
          <li>Header: 34 bytes</li>
          <li>HMAC: 32 bytes</li>
          <li>Reference payload: 9 bytes</li>
          <li><strong>Authenticated frame: 75 bytes</strong></li>
        </ul>
        <p>
          The landing page rounds this to <strong>~100&nbsp;B</strong> as a small authenticated UDP
          uplink example (a few extra schema bytes, or typical IPv4+UDP headers on the wire, land
          near that figure). It is not a claim that every Struct payload is 100 bytes.
        </p>
      </section>

      <section class="method-section">
        <h2>HTTPS / TLS cold-uplink example</h2>
        <p>
          The ~5.2&nbsp;KB HTTPS figure is an <strong>approximate cold TLS + HTTP POST</strong>
          overhead used for the comparison — a new TCP connection, TLS handshake, and a small JSON
          telemetry request. It is <strong>not a packet capture stored in this repository</strong>.
        </p>
        <p>
          <span class="mono">100 / 5200 ≈ 1.9%</span> remaining, which is the source of
          “up to 99% less transmitted data per cold uplink.” That ratio does
          <strong>not</strong> mean the packed struct is 99% smaller than the JSON document.
          The JSON body for this schema is on the order of tens of bytes; most of the 5.2&nbsp;KB is
          session/handshake overhead.
        </p>
        <p>
          Persistent HTTPS/TLS sessions and persistent MQTT connections may have substantially
          lower per-message overhead than a cold connection. MQTT, TCP, and HTTPS are appropriate
          for many workloads; the comparison is limited to intermittent cold uplinks.
        </p>
      </section>

      <section class="method-section">
        <h2>Fleet cost model</h2>
        <p>The ~$2,400/month figure is a model, not a measured invoice:</p>
        <ul>
          <li>10,000 devices</li>
          <li>1 cold uplink per minute</li>
          <li>~5,100 bytes saved per ping (5,200 − 100)</li>
          <li>≈ 2.2&nbsp;TB/month</li>
          <li>$1.10/GB metered cellular</li>
        </ul>
        <p>
          It does not apply if devices keep MQTT or TLS sessions alive, batch readings, or transmit
          less often.
        </p>
      </section>

      <section class="method-section">
        <h2>Still unmeasured</h2>
        <p>
          The following are <strong>not</strong> measured in this repository. Landing-page cells
          say <span class="mono">Benchmark pending</span> rather than guessed numbers.
        </p>
        <ul>
          <li>CBOR, MessagePack, and Protobuf encodings of the sample schema</li>
          <li>JSON + MQTT/TLS per-message size on a warm session</li>
          <li>Radio awake time / “10× less awake time” (no MCU capture yet)</li>
          <li>Battery-life deltas (depend on modem, signal, retries, sleep current, chemistry, temperature, firmware)</li>
          <li>Decode latency on a specific microcontroller</li>
          <li>Compiler flags and MCU used for firmware timing</li>
        </ul>
        <p class="todo">
          TODO: add a reproducible bench that encodes the sample schema to JSON, CBOR, MessagePack,
          and Protobuf; capture cold HTTPS vs Struct UDP with a packet analyzer; record radio-on
          time on a named MCU/modem with published compiler settings.
        </p>
      </section>

      <section class="method-section">
        <h2>Verified from implementation</h2>
        <ul>
          <li>
            Generated headers use <span class="mono">#pragma pack(1)</span> structs and
            <span class="mono">static_assert</span> on size — no
            <span class="mono">malloc</span>/<span class="mono">new</span> in the packing path.
          </li>
          <li>Field types: <span class="mono">float32</span>, <span class="mono">int32</span>, <span class="mono">uint8</span>, <span class="mono">boolean</span>, <span class="mono">flags</span>.</li>
          <li>Transports: TCP stream and UDP datagram, both Protocol v2 + HMAC-SHA256.</li>
          <li>Optional ChaCha20-Poly1305 on Pro/Scale, with timestamp + durable nonce replay checks.</li>
          <li>Destinations are signed HTTPS webhooks, not first-party Datadog/AWS connectors.</li>
        </ul>
      </section>

      <section class="method-section">
        <h2>When other encodings win</h2>
        <ul>
          <li><strong>Protobuf</strong> — schema evolution, nested messages, multi-language codegen.</li>
          <li><strong>CBOR / MessagePack</strong> — self-describing binary without an out-of-band schema.</li>
          <li><strong>MQTT</strong> — long-lived bidirectional sessions, fan-out, command/control.</li>
          <li><strong>HTTPS / JSON</strong> — request/response, firewall traversal, human-debuggable APIs.</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

useSeoMeta({
  title: 'Benchmark methodology — Struct',
  description:
    'Conditions behind Struct’s cold-uplink size comparison, Protocol v2 frame layout, and pending measurements.',
})
</script>

<style scoped>
.method {
  font-family: 'Montserrat', ui-sans-serif, system-ui, sans-serif;
  min-height: 100vh;
  background: #0f1115;
  color: #e8eaef;
}

.method-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid #2a2f3a;
  padding: 1rem 1.5rem;
}

.method-main {
  max-width: 46rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 5rem;
}

.method-title {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: #f4f5f7;
}

.method-lede {
  margin-top: 1rem;
  font-size: 1.125rem;
  line-height: 1.7;
  color: #b4bcc9;
}

.method-section {
  margin-top: 2.5rem;
  padding-top: 2rem;
  border-top: 1px solid #2a2f3a;
}

.method-section h2 {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #f4f5f7;
}

.method-section p,
.method-section li {
  margin-top: 0.75rem;
  font-size: 1.0625rem;
  line-height: 1.7;
  color: #b4bcc9;
}

.method-section ul {
  margin: 0.5rem 0 0;
  padding-left: 1.15rem;
}

.method-section strong {
  font-weight: 600;
  color: #e8eaef;
}

.method-pre {
  margin-top: 0.85rem;
  overflow-x: auto;
  border: 1px solid #2a2f3a;
  border-radius: 10px;
  background: #111319;
  padding: 0.9rem 1rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.55;
  color: #38b6ff;
  white-space: pre-wrap;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85em;
  color: #a8b2c4;
}

.todo {
  border: 1px dashed rgba(56, 182, 255, 0.35);
  border-radius: 10px;
  background: rgba(56, 182, 255, 0.05);
  padding: 0.85rem 1rem;
  color: #a8b2c4;
}

.label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #8b93a7;
}

.nav-logo {
  display: inline-flex;
  align-items: center;
}

.btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  padding: 0.45rem 0.85rem;
  color: #e8eaef;
  text-decoration: none;
}

.btn-ghost:hover {
  border-color: rgba(56, 182, 255, 0.45);
}
</style>

# Struct Protocol Lab — implementation and deployment review

The public `/benchmarks` route is now an interactive Nuxt application, backed by real serializers, the repository's Secure V2 implementation, validated protocol framing rules, and a sanitized server-side benchmark index. No production service, credential, device, schema, landing-page source, or packet format was changed. No deployment was performed.

This is a working lab with explicit coverage limits. It does **not** claim that every setting in the original product brief has a custom-schema network model. In particular, MQTT/HTTPS TCP/IP totals and arbitrary LwM2M object layouts remain unavailable.

## Run locally

From the repository root, with Node 20+ and npm:

```powershell
npm --prefix web ci
npm --prefix web run dev -- --host 127.0.0.1 --port 3100
```

Open `http://127.0.0.1:3100/benchmarks`. No production environment variables are needed for the lab. Its calculation and reference endpoints are public and never call Supabase, Stripe, a broker, or a device gateway. Existing unrelated website authentication continues to use the site's normal configuration.

```powershell
npm --prefix web run lab:data
npm --prefix web run test:lab
npm --prefix web run typecheck
npm --prefix web run build
npm exec --prefix web -- playwright install chromium
npm --prefix web run test:lab:browser
```

The browser suite starts/reuses a local Nuxt server on port 3100. To test a local built server instead, set `LAB_BASE_URL=http://127.0.0.1:3101`. Do not point this suite at production. The test deliberately submits invalid inputs and makes repeated calculator requests.

`predev` and `prebuild` regenerate the compact index. The normalized archive is tracked in Git, so builds do not require restoring the much larger raw capture archive. The generated compact assets are also included in the implementation for inspection and tests. Research observations remain unchanged.

## What was implemented

- A public, dark-themed Protocol Lab layout using the existing header, footer, fonts, theme tokens and purple accents.
- Desktop settings sidebar; collapsible tablet/mobile settings; keyboard-accessible, horizontally scrollable comparisons.
- Editable fields, names, types, sample values, order, integer widths, explicit fixed-point constraints, enum labels, optional/absent and repeated fields. Nested definitions can be edited through validated schema JSON.
- Original ESP32 and environmental, GPS, vehicle, industrial, smart-home, energy, air-quality and water-meter presets from the research schema library.
- Global security, delivery, precision, batching, traffic direction, boundary and baseline selection; five default columns and optional CBOR.
- Advanced MQTT versions/QoS/topic/properties, Protobuf field numbering/packed repeats, JSON and CBOR layouts, CoAP token/path/OSCORE profiles/sequence/serializer, IPv4/IPv6, MTU, TLS version, connection reuse accounting, HTTPS/gzip and LwM2M format selection.
- A per-metric explanation dialog with real payload hex, decoded semantics, methodology, implementation, original benchmark IDs, source links, byte breakdown and comparison restrictions.
- Stacked byte breakdowns and discrete scaling charts. Scaling re-encodes batch counts, copies of the first field, or binary input sizes; it does not interpolate observations.
- Decimal-MB fleet ROI with cellular fraction, operating days, measured baseline overrides, monthly/annual views, metered/flat billing, per-device minimums and explicit per-event rounding assumptions. Missing network traffic cannot produce connectivity costs.
- JSON/CSV exports, shareable URL fragments, reset, error recovery, debounced requests, abort handling and bounded calculation caching.
- An on-demand Research Explorer with all **65,019** original configuration IDs, including unsupported results; search, status filtering, pagination, original raw-file/line references, profiles and schema definitions.
- Actual generated Struct C payload headers and factual integration requirements with SDK/starter/documentation links.

## Files and layers

| Area | Files |
|---|---|
| Public page | `web/app/pages/benchmarks.vue` |
| Preserved historical methodology | `web/app/pages/benchmark-methodology.vue` |
| Layout/design | `web/app/layouts/protocol-lab.vue`, `web/app/assets/css/protocol-lab.css` |
| UI components | `web/app/components/protocol-lab/LabSidebar.vue`, `LabSchemaEditor.vue`, `LabComparison.vue`, `LabExplanation.vue`, `LabCharts.vue`, `LabRoi.vue`, `LabResearchExplorer.vue`, `LabIntegration.vue` |
| Types, defaults, preset/share adapters, ROI | `web/shared/protocol-lab/types.ts`, `config.ts`, `roi.ts` |
| Real serializers and validation | `web/server/protocol-lab/encoding.ts` |
| Central protocol profiles, framing, eligibility and scaling | `web/server/protocol-lab/engine.ts` |
| Cached research loading | `web/server/protocol-lab/data.ts` |
| Public APIs | `web/server/api/protocol-lab/calculate.post.ts`, `references.get.ts` |
| Index derivation | `web/scripts/build-protocol-lab.mjs` |
| Generated server-only index | `web/server/assets/protocol-lab/index.json.gz` |
| Small public registry/presets | `web/public/protocol-lab/metadata.json` |
| Engine and archive regressions | `web/server/protocol-lab/engine.test.ts`, `archive.test.ts` |
| Browser regression suite | `web/test/protocol-lab/lab.spec.ts`, `web/playwright.lab.config.ts` |
| Build integration/dependencies | `web/nuxt.config.ts`, `web/package.json`, `web/package-lock.json` |

The former `/benchmarks` document is preserved on a separate archival route, with a notice distinguishing its old landing-page assumptions from current research. The landing page itself is unchanged.

## Research used

Primary input: `benchmarks/multi-protocol/results/normalized/records.ndjson.gz`.

Supporting inputs:

- `schemas/library.json`: 367 schema/value cases, representing 150 schema definitions.
- `config/compatibility.json`.
- `references/security-matrix.json`, `implementations.json`, `sources.json`.
- `results/summaries/coverage.json`.
- `reports/FINAL-REPORT.md`, `CALCULATION-RULES.md`, `REPOSITORY-AUDIT.md`, `DEVELOPER-EXPERIENCE.md`.
- Real implementations in `sdk/js/secure-v2.cjs`, `protocol/schema/bitpacked.cjs`, and `web/shared/schemaCodegen.ts`.
- Independent Python serializer and network observations referenced by every retained benchmark ID.

The compact index has **65,019 records**, **5,804 interned profiles**, and **367 schema/value cases**. Of the research records, 63,944 passed and 1,075 were unsupported. This is reference coverage, **not** a claim that all 65,019 are interchangeable calculator configurations.

The current index is **3,155,914 bytes** compressed, server-only. Public metadata is approximately 38 KB. Neither raw captures nor the 91+ MiB research archive are fetched by ordinary visitors. The index preserves IDs, configuration profiles, schema/value definitions, versions, selected environment metadata, measurement boundaries, security/delivery semantics, lengths, timestamps, validation results, precision errors, unsupported reasons, and original raw-file/line pointers. Full original observations remain in the research archive; this derived index is not a replacement for it.

New runtime serializers are protobuf.js 8.8.0, node-cbor 10.0.12 and coap-packet 1.1.1; exact installed versions are locked. The reference implementations remain identified separately (Google Protobuf, cbor2, aiocoap, Paho/NanoMQ, Leshan/Scandium, Python/OpenSSL). Using a different encoder implementation is validated against the archive rather than mislabeled as a new captured run.

## Exact, calculated, measured and modeled values

### Struct

Original fields use the current little-endian schema rules and generated C header. Packed fields use the real bitpacked compiler/encoder/decoder. The calculator constructs real authenticated Secure V2 frames with isolated illustration credentials, authenticates/decrypts them, and verifies generated receipts. It sends no packets. Lengths are **calculated from real encoded buffers**, not labeled captured measurements.

V2 is always ChaCha20-Poly1305. Security Off selects legacy **HMAC-authenticated plaintext**. It never creates an unencrypted V2 profile. Original and optimized cases remain separate; fixed-point quantization is applied to every competitor too.

V2 batching uses the actual SDK splitter, count framing and per-frame receipts. Secure V2's current Node transport is IPv4-only. An IPv6 request explicitly makes Struct unsupported.

### Protobuf, JSON and CBOR

Custom payloads are encoded with protobuf.js, the documented JSON convention and node-cbor. Decoding is checked against transformed values, including bytes, 64-bit integers, nesting and repetition. Protobuf tags, varints, packed repeats and field numbers are real encoding operations. JSON names, whitespace, floating representation and tagged bytes/large integers affect lengths. Canonical CBOR preserves declared floating semantics and uses the smallest lossless IEEE representation.

MQTT PUBLISH, Remaining Length, topic, packet identifiers, MQTT 5 properties and publisher acknowledgments are deterministic framing calculations validated against real Paho observations. They are **application bytes**. TLS stream results are available only when the schema, values, layout and configuration match an archived measurement and the application lengths agree. Custom TLS record splitting, TCP segments/options/ACKs and full IP traffic are not guessed.

### CoAP and OSCORE

Plain CoAP uses the real coap-packet encoder. OSCORE envelope lengths follow RFC8613, including inner code/options, KID, variable Partial IV, AEAD tag and request-bound response. The lab calculates envelope lengths; it does **not** claim to execute aiocoap encryption in the website process. Its calculated datagram lengths are cross-checked against independent aiocoap OSCORE measurements. AEAD tag lengths are 8 or 16 bytes according to the selected supported profile.

Every CoAP example endpoint returns 2.04, including NON. Therefore full exchanges include that response. A NON response is not a database-commit receipt. Different token, URI, integer and sequence boundaries are encoded rather than interpolated.

### LwM2M

Native Send uses matching Leshan observations only: the original schema/object layout, one reading, IPv4, SenML format and selected UDP/DTLS mode. Arbitrary schemas, optimized precision, alternate object mappings and batching do not inherit the original sample's network size. TLV Read, registration/update, Observe, codecs and other experiments are inspectable in Research Explorer but not fabricated as custom Send models.

The native Send runner did not separately instrument the decrypted SenML payload. That row is **unknown**, even though its complete datagrams are measured. DTLS 1.2 ECDHE-PSK/AES-GCM has forward-secrecy and lifecycle properties different from static-PSK Struct/OSCORE.

### Network, connection and ROI boundaries

Minimum UDP headers (8 B), IPv4 headers (20 B) and IPv6 headers (40 B) are specification-calculated. No physical Wi-Fi, Ethernet, cellular framing or ESP32 energy is inferred. Above-MTU CoAP totals are withheld; the calculator does not invent fragmentation or blockwise exchanges. Struct checks each real split frame individually.

Persistent mode displays steady-state traffic. New/periodic MQTT sessions can include **exact matching measured complete session streams**, amortized over tested reuse counts; setup is not charged to every message. Unmatched counts/topic/schema settings and unsupported directional totals remain unknown. Keepalive, registration and retries are not universally modeled. If setup accounting is disabled, the UI explicitly labels costs excluded from reconnection scenarios.

ROI is **modeled** from available network estimates. Annual applicable events are devices × events/device/day × operating days × cellular fraction. MB means 1,000,000 bytes. Monthly means annual/12. Per-event billing increments are explicit assumptions, not a claim about carrier sessions. Flat-rate costs do not decline with byte usage. The default price is an editable example, not a provider quote. Subscription fees and adoption costs are excluded.

## Comparability policy

A ranking or reduction requires an available selected metric and compatible boundary, direction, precision, batch, connection accounting, algorithm/tag, identity class, forward secrecy and delivery/response semantics. Unknown is represented as null, never zero.

Compatible examples:

- Protobuf/JSON/CBOR using the same MQTT version, QoS, TLS/server identity, connection accounting and stream/application boundary.
- Struct Secure V2 and CoAP/OSCORE ChaCha20-Poly1305 **unconfirmed uplink only**, with equivalent precision, static paired-PSK identity and compatible accounting. This is a limited traffic comparison, not a claim of identical security systems.

Examples deliberately not ranked:

- Struct database-commit receipt vs MQTT PUBACK or CoAP 2.04.
- Struct's no-response uplink vs CoAP's response-bearing full exchange.
- Static-PSK security vs ephemeral TLS/DTLS forward secrecy.
- Authenticated legacy Struct plaintext vs unauthenticated CoAP/MQTT plaintext.
- TLS stream bytes vs full UDP/IP totals.
- Original-precision data vs explicitly quantized data.

The UI can show valid independently labeled values side by side while withholding an invalid reduction percentage. Minimum highlighting is restricted to compatible groups. User-supplied measured ROI baselines are explicitly assumptions and do not establish equivalent security.

## Reference regression

Original values: temp=23.5, humidity=61.25, is_active=true.

| Metric | V2 original | V2 optimized |
|---|---:|---:|
| Sensor bytes | 9 | 3 |
| Sensor hex | `0000bc410000754201` | `4f732c` |
| Header | 9 | 9 |
| AEAD tag | 16 | 16 |
| Application uplink | 34 | 28 |
| Estimated IPv4 uplink | 62 | 56 |
| Confirmed application receipt | 21 | 21 |
| Confirmed estimated IPv4 exchange | 111 | 105 |
| Decoded humidity | 61.25 | 61.3 |

The 25-byte fixed-overhead target is preserved. Compared with the user's **unencrypted** V1 103-byte IPv4 uplink, original/optimized V2 are 39.81%/45.63% smaller; this is not an equivalent-security or equivalent-precision comparison. Those marketing reductions are not automatically presented as eligible calculator comparisons.

Other original serializer regressions: Protobuf 12 B, compact JSON 47 B, spaced JSON 52 B, positional JSON 17 B, CBOR canonical map 32 B, CBOR positional 8 B, CBOR integer-key map 11 B. CoAP/OSCORE CCM-8 positional CBOR has a 33-byte application uplink, 61-byte estimated IPv4 uplink and 106-byte exchange. ChaCha/tag-16 gives 41/69/122. These do not share Struct's full-exchange response semantics.

## Verification and limitations

Verification completed locally:

- TypeScript/Nuxt type check passed.
- Production Node-server build passed, including public route prerendering. Existing large-chunk warnings remain elsewhere in the application.
- 27 calculator engine/archive tests pass. Independent archive cross-checks cover **2,588 serialization records across all 367 schema/value cases**, **640 CoAP/OSCORE configurations**, and **1,440 MQTT configurations**: **4,668 reference checks** in total.
- 15 browser checks exercise the built server at desktop 1440px, tablet 820px and mobile iPhone-sized viewports. They exercise live editing, quantization, receipts, batching, IP selection, invalid values, security mapping, keyboard focus, overflow, explanations, references, export, share restore and ROI.
- 165 website/calculator tests pass when the firmware-build file is excluded. Its two code-generation checks also pass independently. The full suite was attempted: the ESP32 firmware build passed, while the ESP32-C3 build failed because the local PlatformIO RISC-V package installation could not supply `riscv32-esp-elf-g++` (installation/rename/container-directory errors). This is reported rather than skipped silently or called a calculator failure. No production SDK code was modified to conceal it.
- No separate lint script exists in the website. New source files were formatted; type checks and builds validate Vue/TypeScript compilation.

Remaining custom-model coverage:

- Captured full TCP/IP totals for MQTT/TLS and HTTPS, including ACKs/options/segmentation.
- Arbitrary TLS/DTLS record segmentation, handshakes, resumption/mTLS and keepalive schedules.
- Arbitrary LwM2M object/resource encoding and lifecycle amortization; TLV Read is not unsolicited Send.
- Dynamic CoAP DTLS, Observe/blockwise/fragmentation and alternative retry/response policies.
- Native Struct IPv6, strings/nesting/repeats/64-bit types and native compression where the current SDK lacks them.
- Legacy encrypted V1 is available as research references, not a new configurable production codec.
- Impairment controls deliberately withhold custom scenario totals: measured seeded loss/latency experiments do not define a universal loss multiplier. Inspect actual experiments in Research Explorer.
- CPU/memory/performance and ROI provider-pricing research are retained in the archive, not turned into universal live-computer or carrier claims.
- Generalized arbitrary HTTP headers/body compression sizes beyond matching observations.

Important deficiencies exposed while integrating:

1. TCP stream bytes cannot support precise carrier ROI without packet counts; adding a fixed TCP header once would undercount.
2. Native LwM2M payload isolation and custom object coverage are narrower than its overall record count suggests.
3. Python JSON floating conventions, negative zero, tagged large integers and positional absence matter. The derived writer was corrected to preserve negative zero; the original observations were not overwritten.
4. OSCORE sender sequences change Partial-IV overhead; constant overhead is unsafe across boundaries.
5. Benchmarked endpoint responses and database persistence guarantees differ, even when both say confirmed.
6. OSCORE/DTLS negative-test and device-performance coverage are implementation-specific; no broad equivalence claim is supported.

## Maintenance and deployment review

The lab performs bounded, isolated encoding only. Input is limited to 64 KiB, 128 fields, depth 3, 100 readings/batch and 64 KiB encoded messages; reserved names and malformed values are rejected. There is no eval, user-generated executable code, arbitrary outbound endpoint, shell execution or database access in either endpoint. Calculation caching is bounded and process-local; it is not persisted or logged by this feature. Sample schemas are sent to the site's calculation API: users should not include credentials or sensitive samples. Share fragments and exports intentionally contain sample values.

The rate limiter is best-effort and per server instance, not a distributed abuse-prevention service. Reverse-proxy forwarding must be trusted by the deployment. Before exposing a heavily used public endpoint, review platform-level limits, request concurrency, cold-start memory and privacy/logging policies. No new paid service was introduced.

Deployment review should confirm the generated index is included as a Nitro server asset, the calculation/reference APIs remain available, and the deployment uses a server-capable Nitro preset. A static-only `nuxt generate` host cannot run the encoders. Keep production secrets out of public assets and preserve the server-only boundary.

The feature is ready for a **production deployment review with these documented scope limits**. It has not been deployed and is not a claim that every advanced feature from the original brief is complete.

### Local validation measurements

On this host, a 12-request built-server check using changed sample values (six protocol results plus scaling and JSON response) took approximately 15.5 ms median and 25.9 ms p95. This small local request sample excludes network deployment latency and cold starts; it is not an MCU or protocol throughput benchmark. The compressed 3.16 MB index inflates to 79,588,838 bytes of JSON, so cold-start memory and concurrency should be checked in the target hosting runtime.

The calculator build was verified with Node 24.18.1, Nuxt 4.5.2 and Vue 3.5.42 from the existing locked framework versions. This change adds serializer/testing dependencies without upgrading existing framework entries in the lockfile.

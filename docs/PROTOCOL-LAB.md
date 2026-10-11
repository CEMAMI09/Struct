# Struct Protocol Lab — implementation, coverage and rollout

The public `/benchmarks` Nuxt page now defaults to **optimized Secure V2, security On, Simple results**. Results view state is independent of settings and survives validation errors without triggering new calculation requests.

Read the additive [extension findings](../benchmarks/multi-protocol/extensions/lab-v2/REPORT.md), [root-cause audit](../benchmarks/multi-protocol/extensions/lab-v2/ROOT-CAUSES.md), [coverage summary](../benchmarks/multi-protocol/extensions/lab-v2/coverage-summary.json) and [reproduction guide](../benchmarks/multi-protocol/extensions/lab-v2/README.md). Original research observations and the landing page remain unchanged. No production device/data/credentials/configuration was changed; no migration was applied and nothing was deployed.

## Run locally

```powershell
npm --prefix web ci
npm --prefix web run dev -- --host 127.0.0.1 --port 3100
```

Open `http://127.0.0.1:3100/benchmarks`. The calculator APIs perform bounded encoding, never contact Supabase, Stripe, brokers or device gateways, and need no production credentials. Visitors' example values are submitted to the website encoding API; do not include secrets.

```powershell
npm --prefix web run lab:data
npm --prefix web run test:lab
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run test:lab:browser
```

`predev`/`prebuild` derive the index. Browser tests use a local Nuxt server on 3100 unless `LAB_BASE_URL` names another local preview. To preview the production build, set `NITRO_HOST=127.0.0.1` and `NITRO_PORT=3102`, then run `node web/.output/server/index.mjs`; test it with `LAB_BASE_URL=http://127.0.0.1:3102`. Never point the mutation/invalid-input test suite at production. A server-capable Nitro deployment is required; static hosting cannot run the encoders.

## Architecture

| Layer | Main files |
|---|---|
| Page and result modes | `web/app/pages/benchmarks.vue`, `components/protocol-lab/LabComparison.vue` |
| Schema/settings/evidence | `LabSchemaEditor.vue`, `LabSidebar.vue`, `LabExplanation.vue` |
| Charts, integration, research, ROI | `LabCharts.vue`, `LabIntegration.vue`, `LabResearchExplorer.vue`, `LabRoi.vue` |
| Defaults, sharing, types, ROI | `web/shared/protocol-lab/{config,types,roi}.ts` |
| Real serializers and validation | `web/server/protocol-lab/encoding.ts` |
| Protocol profiles and comparison | `web/server/protocol-lab/engine.ts` |
| Explicit network model | `web/server/protocol-lab/network-model.ts` |
| SenML/custom object encoding | `web/server/protocol-lab/lwm2m.ts` |
| Index/data/API | `web/scripts/build-protocol-lab.mjs`, `web/server/protocol-lab/data.ts`, `web/server/api/protocol-lab/` |
| Real compiler/gateway | `protocol/schema/bitpacked.cjs`, `tcp-server/secure-v2.js` |
| Generated device project | `web/shared/{secureV2Schema,secureV2Project}.ts`, `SecureV2Setup.vue` |
| Isolated plaintext profile | `protocol/schema/lab-plaintext.cjs` |
| Tests | `web/server/protocol-lab/*.test.ts`, `web/test/protocol-lab/lab.spec.ts` |

Existing custom fields, presets, advanced controls, charts, explanations, Research Explorer, JSON/CSV exports, share URLs, ROI, responsive styling, caching and validation remain functional. The independent results control initially shows total bytes, differences, security, delivery and factual integration requirements; Advanced exposes technical rows and expandable security/reliability groups.

## Research integration

The sanitized server-only index combines original `results/normalized/records.ndjson.gz` with additive `extensions/lab-v2/records.ndjson.gz` and supplemental registries. It contains **71,359 records**: 65,019 original + 6,340 new successful local configurations. Combined statuses: 70,284 passed, 1,075 unsupported. Zero retained failed rows is not a claim that every requested feature passed or every combination was tested.

There are 389 schema/value entries (not unique definitions), 7,424 profiles and approximately 3.52 MB compressed server-only index data. Raw extension observations occupy approximately 2.59 MB compressed. Ordinary visitors receive metadata/results rather than the raw archive. IDs, configuration, versions, source hashes, boundaries and raw artifact/line pointers remain traceable.

## Comparability and calculation boundaries

Data, security, delivery and measurement are independent dimensions. Size percentages require available metrics at the same boundary/direction per logical reading. All serializers use the same prepared logical data and declared precision. Security or acknowledgment differences produce **disclosed differences**, rather than rejecting valid byte arithmetic. Missing values remain null. No percentage mixes TLS stream bytes with IP traffic.

The normal finite matrix covers ten presets × six protocols × two security/delivery/precision/batch/IP choices: **1,920/1,920** available results and reductions, versus 384 results and 60 reductions before. This includes explicit models, not 1,920 captures. Advanced coverage retains unsupported/missing cases separately.

- Struct constructs/decrypts real Secure V2 frames, actual batch envelopes and authenticated receipts. Website lengths are calculated; separate local runners transmit and store real packets.
- Protobuf uses protobuf.js; JSON documented conventions; CBOR node-cbor with typed float semantics. Tags, varints, names, UTF-8, widths and lengths come from real serializers.
- MQTT application framing/acknowledgments are validated against actual Paho/NanoMQ observations. Matching measured TLS streams remain available.
- CoAP/DTLS CCM8/CCM16 exposes exact matching archived IPv4 references with pinned /t and library tokens; custom DTLS framing/lifecycle is not inferred.
- CoAP uses coap-packet; OSCORE envelope rules are cross-checked against real aiocoap results. The website does not claim to execute OSCORE encryption.
- Custom LwM2M Send uses real RFC8428 SenML encoding and an explicit `/33000/0/<index>` object mapping. Forty payloads were independently decoded by Leshan. Batched values carry example relative times 0..n-1 seconds. Custom DTLS is an explicit archived CID6/GCM envelope model, not a newly captured custom Send session. Original matching native Send observations remain measured.
- UDP/IP headers are specification-calculated: UDP8 + IPv4 base20 or IPv6 base40. Oversized UDP network totals are withheld; fragmentation/blockwise is not invented.
- TCP totals are **estimated**: minimum TCP20/IP20 or40; MSS=MTU-IP-TCP; separate flushed application flights; TLS1.3 overhead22 or TLS1.2 AES-GCM overhead29; max16KiB content/record; one standalone ACK/data segment; no options, delayed ACK, piggyback or loss. Actual packetization can differ.
- Reconnect accounting requires matching measured setup references. Combined setup can be modeled/amortized; missing directional setup, arbitrary handshakes, keepalives and resumption remain unknown.

The normalized application wire boundary includes TLS records, as UDP datagrams include their message security. Raw MQTT/HTTP application rows remain separately inspectable. TCP models are not physical carrier captures or evidence of identical security guarantees.

## Real schema expansion and rollout

Additive `bitpacked-v1` supports **Float64**, signed/unsigned widths 1..64, bounded UTF-8 strings and raw bytes. Boolean, enums, fixed/ranged decimals, bitsets, Float16/Float32 remain supported and tested. Timestamps use uint64 milliseconds. Original precision is retained; new types use the packed codec because the legacy little-endian codec cannot represent them.

Float64 is finite IEEE754 binary64; NaN/Infinity are rejected. JSON storage preserves numeric values rather than promising bitwise signed-zero identity. Tests preserve `1.0000000000000002` exactly through C encoder parity and authenticated gateway ingestion. Wide values use BigInt/decimal strings, never unsafe Number coercion. Gateway JSON stores exact integers as `{"$integer":"18446744073709551615"}` and binary as `{"$bytes":"00ff"}`.

String/bytes require `maxBytes` 1..256. Each reserves a two-byte big-endian length plus its bounded region, zero-padded. This preserves fixed-record batching and predictable MCU allocation at the cost of unused capacity. Invalid UTF-8, lengths and padding are rejected. Existing numeric schemas gain no metadata or changed wire bytes. Generated C uses explicit bit writers, double/int64_t/uint64_t and capacity/range checks.

**Roll out decoder/compiler together before publishing new types into unused immutable slots.** Generate firmware for that new slot; never overwrite/reinterpret existing slots. Existing vectors pass unchanged. No database migration is required for these additive JSON schema definitions; existing publication/RPC checks were exercised locally. No production publication occurred. Node SDK adds explicit udp6 with udp4 default; production gateway binding and ESP32 transport remain unchanged.

Nested, optional/nullable, repeated/variable arrays and generic fixed-length typed arrays remain unsupported by Struct. Bounded byte arrays are supported, not arbitrary typed arrays. Competitor encoders retain their broader supported structures.

## Security Off

Security Off selects **SLB0: V2-compatible plaintext LAB ONLY**. It is a separate encoder/receiver: magic4 + control1 + device4 + sequence4 = **13-byte header**. Same sensor encoding/batching semantics; no encryption, MAC, tag, replay protection or authenticated identity. Optional SLR0 receipt is **9 unauthenticated bytes**, promising local decode only. Every plaintext benchmark packet was rejected by production `processFrame`. Production Secure V2 remains mandatory ChaCha20-Poly1305 and never imports this receiver.

Legacy V1 is an explicit advanced generation choice, HMAC-authenticated plaintext with the original codec and no native batching. It is never the global security toggle's fallback. Legacy encrypted research remains inspectable, not an invented calculator transport.

| ESP32 reference | V2 original | V2 optimized | Optimized SLB0 lab |
|---|---:|---:|---:|
| Sensor bytes | 9 | 3 | 3 |
| Application uplink | 34 | 28 | 16 |
| Estimated IPv4 uplink | 62 | 56 | 44 |
| Confirmed application receipt | 21 | 21 | 9 |
| Confirmed estimated IPv4 exchange | 111 | 105 | 81 |
| Decoded humidity | 61.25 | 61.3 | 61.3 |

Secure V2's fixed overhead remains **25 bytes**. Optimization is explicitly lossy in this example, and every competitor receives equivalent scaled values. Fields without complete precision constraints retain original representations. SLB0's separate domain prefix means Security Off does not merely subtract the production tag.

## ROI and remaining limits

Annual applicable events = devices × events/day × operating days × cellular fraction. Multiply selected network bytes/logical reading, with batch division already applied. Decimal MB=1,000,000 bytes; monthly=annual/12. Selected direction and connection accounting affect costs. Model assumptions are disclosed; stream-only bytes cannot produce network costs. Measured current MB/month or bytes/event are explicit user overrides. Flat-rate bills do not fall automatically. Plan minimums/per-event increments are modeled; carrier session rounding, radio framing and Struct subscription fees are excluded.

Remaining work: actual TCP/IP captures; custom native LwM2M Send/DTLS interoperability and registration lifecycle; oversized UDP fragmentation/blockwise; arbitrary retries/impairment/keepalives/resumption; complex Struct fields; physical ESP32 timing/memory/power qualification. ESP32-C3 firmware compilation is currently blocked by a missing local RISC-V compiler executable; it is not reported as passing device qualification.

The feature is ready for deployment review with these documented model limits and coordinated schema rollout. It has not been deployed. Exact serializer/datagram results and explicitly labeled scenario estimates can support a public comparison; modeled network traffic must not be advertised as captured cellular traffic or equivalent-security customer savings.

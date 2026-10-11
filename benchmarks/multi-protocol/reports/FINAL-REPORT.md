# Multi-protocol benchmark final report — dataset1.0.0

## Outcome and scope

Executed **65,019 retained configurations: 63,944 passed, 0 failed, 1,075 explicitly unsupported**. The library contains **367 tested schema/value cases and 150 distinct field definitions**. Cases sharing a schema at different boundary values are not counted as different definitions. Configuration rows are not individual readings, packets or a complete cross-product. The final dataset contains raw serialization tests as well as actual network exchanges.

| Runner | Passed | Unsupported | Failed |
| --- | --- | --- | --- |
| coap-advanced.ndjson | 22 | 0 | 0 |
| coap-dtls.ndjson | 1190 | 166 | 0 |
| coap.ndjson | 30896 | 0 | 0 |
| https.ndjson | 2048 | 0 | 0 |
| lwm2m-codecs.ndjson | 1667 | 535 | 0 |
| lwm2m-network.ndjson | 16 | 0 | 0 |
| mqtt-connections.ndjson | 756 | 0 | 0 |
| mqtt.ndjson | 22320 | 0 | 0 |
| serialization.ndjson | 3447 | 1 | 0 |
| struct-impairment-normalized-input.ndjson | 24 | 0 | 0 |
| struct.ndjson | 1558 | 373 | 0 |

Four actual C/mbedTLS gateway modes, four C-pilot tamper rejections and two TLS negative-test configurations are supplemental validation, outside those configuration counts. Unsupported rows are real mapping/capability exclusions; they are not successful transmissions. Earlier failed development attempts are documented in the repository audit, including the DTLS timeout and LwM2M mixed-traffic investigation. Zero failures in the retained run does not mean every requested option is supported.

All services ran locally with disposable credentials and database state. No production services, live devices, Supabase, credentials, gateway configuration, website, landing page or calculator were modified. No cloud benchmark service was purchased. Production implementations were reused, not rewritten for benchmark convenience.

## Implementations and coverage

| Implementation | Version | Role |
| --- | --- | --- |
| struct | 474e6b73f147c4dc4fef840ac5d0f66b46d86434 | Node24 and C/mbedTLS WASI pilot |
| protobuf | 7.36.2 | google.protobuf Python |
| json | 3.11.9 | Python json |
| cbor | 6.1.5 | cbor2 Python |
| mqtt | Paho2.1.0 + NanoMQ0.25.6 | Python client + portable native Windows broker |
| coap-oscore | 0.4.17 | Python aiocoap |
| coap-dtls | Californium/Scandium4.0.0-M6 | Java21; bundled Leshan dependencies |
| lwm2m | Leshan2.0.0-M18 | Java21 |
| https | 3.11.9 / OpenSSL 3.0.13 30 Jan 2024 | Python HTTP1.1 endpoint + TLS proxy |

Standards include Protobuf wire encoding; JSON/CBOR; MQTT3.1.1/5; CoAP, OSCORE, Observe and blockwise; TLS1.2/1.3 and DTLS1.2; LwM2M1.1 and its content formats. Current standards research also records the backward-compatible TLS1.3 revision RFC9846 and the separate unmeasured DTLS1.3/LwM2M1.2 targets. Actual package/tool hashes and licenses are retained. Leshan/Californium are pinned milestone builds, not an assertion that every standard feature is complete or that these versions should be deployed in production.

Security coverage: legacy HMAC plaintext, legacy ChaCha20-Poly1305 plus HMAC, mandatory Secure V2 ChaCha20-Poly1305, OSCORE AES-CCM tags8/16 and ChaCha20-Poly1305, certificate-verified server TLS1.2/1.3, DTLS1.2 PSK CCM tags8/16, LwM2M DTLS1.2 ECDHE_PSK AES128GCM, and insecure CoAP/LwM2M reference modes. There is no unencrypted Secure V2. Device identity, forward secrecy, replay, tag/nonce framing and key lifecycle differ; see the separate security matrix. MQTT/HTTPS server-only TLS is not the same device-authentication guarantee as Struct PSKs. Struct/OSCORE and the direct pure-PSK CCM experiments have no forward secrecy. The LwM2M pilot negotiates ECDHE_PSK AES128GCM (0xD001), whose ephemeral exchange supports forward secrecy under proper key handling; it must not be collapsed into the pure-PSK category.

Delivery coverage: Struct unconfirmed and authenticated receipts; MQTT QoS0/1/2; CoAP CON/piggyback ACK and NON/application response; actual CoAP retries, Observe and blockwise; HTTPS200; LwM2M registration/update/Read/native Send. Struct's main V2 gateway receipt follows a real local database transaction. MQTT PUBACK/PUBCOMP, CoAP2.04, HTTP200 and the impairment mock sink do not establish database persistence.

Batch sizes **1/2/5/10/25/50/100** are covered where meaningful. Struct uses native equal-size batches with actual splitter behavior. Competitors use explicit application array/repeated-message envelopes. LwM2M's measured multi-resource values are one reading; broader time-series batching is not claimed.

Network coverage: IPv4 and IPv6 device legs for MQTT/HTTPS/CoAP/OSCORE; IPv4 for current Struct SDK, DTLS and LwM2M. TLS/broker backhaul is local IPv4 and excluded from the device-leg measurement. Persistent/fresh/reused connections,1/2/5/10/25/50/100 readings per MQTT connection and actual idle PING traffic are recorded. DNS, session recovery after outage, TLS resumption/0RTT and alternative certificate chains are not measured.

## Original ESP32 schema: actual reference comparisons

All rows use temp23.5, humidity61.25 and active=true at original precision except the explicitly optimized V2 row. CoAP reference settings: token2, URI `/t`, content format, CON with2.04 response. OSCORE costs use the recorded sender sequence/context. These are observed configurations, not a universal ranking.

| Actual configuration | Payload B | Datagrams up B | Datagrams down B | IPv4 uplink B* | Exchange B* |
| --- | --- | --- | --- | --- | --- |
| Legacy plaintext / HMAC | 9 | 75 | 69 | 103 | 200 |
| Legacy encrypted / HMAC | 9 | 107 | 69 | 135 | 232 |
| Secure V2 original / commit receipt | 9 | 34 | 21 | 62 | 111 |
| Secure V2 optimized / commit receipt | 3 | 28 | 21 | 56 | 105 |
| protobuf + CoAP plain | 12 | 23 | 6 | 51 | 85 |
| json-compact + CoAP plain | 47 | 58 | 6 | 86 | 120 |
| cbor-canonical + CoAP plain | 32 | 43 | 6 | 71 | 105 |
| cbor-array + CoAP plain | 8 | 19 | 6 | 47 | 81 |
| CBOR array + CoAP/OSCORE CCM8 | 8 | 33 | 17 | 61 | 106 |
| CBOR array + CoAP/OSCORE CCM16 | 8 | 41 | 25 | 69 | 122 |
| CBOR array + CoAP/OSCORE ChaCha20 | 8 | 41 | 25 | 69 | 122 |
| Protobuf + CoAP/DTLS CCM8 echo | 12 | 65 | 61 | 93 | 182 |
| Protobuf + CoAP/DTLS CCM16 echo | 12 | 73 | 69 | 101 | 198 |
| LwM2M Send SenML CBOR plain | — | 52 | 12 | 80 | 120 |
| LwM2M Send SenML CBOR DTLS | — | 96 | 56 | 124 | 208 |

*Datagram content lengths are measured. IPv4 totals add calculated UDP8+IPv4 minimum20 per actual datagram; they are not packet captures. Exchange totals are steady-state and exclude separately recorded initialization. DTLS echo returns the whole payload, unlike the empty CoAP2.04 or Struct receipt. LwM2M Send has a separate lifecycle and SenML structure; see raw diagnostics and the calculation rules. Payload sizes are blank when the network runner did not separately instrument decrypted serialization; codec tests are separate rather than silently substituted.

The actual DTLS handshakes negotiate6-byte connection IDs in both directions. Their visible record headers are19bytes, and the true content type is inside encryption. The analyzer parses the Hello/cipher/CID extensions and validates record lengths, retaining these settings in normalized records. These are actual selected-stack defaults, not a universal DTLS fixed overhead. CID-disabled or migration/reconnection comparisons need additional tests.

The legacy75-byte baseline is authenticated but **unencrypted**, so its103-byte estimated IPv4 uplink is not an equivalent-security comparison. V2 original is **9B payload, 34B application uplink, 62B estimated IPv4 uplink**; optimized is **3B, 28B, 56B**, respectively. Both have21-byte receipts. Relative to the unencrypted103-byte historical baseline, estimated uplink reductions are **39.81%** and **45.63%**. These percentages combine different security/precision choices and must be labeled accordingly. The real V2 implementation meets the25-byte fixed-overhead target.

The optimized schema is explicitly temp[-40,125] step0.1, humidity[0,100] step0.1, boolean. Humidity becomes61.3, error0.05; this meets the declared precision but is not lossless. The same quantization transform is offered to competitor serializers in separate optimized cases.

| Raw serializer, original semantics | Measured payload B |
| --- | --- |
| protobuf | 12 |
| json-compact | 47 |
| json-standard | 52 |
| json-array | 17 |
| cbor | 44 |
| cbor-canonical | 32 |
| cbor-array | 8 |
| cbor-integer-keys | 11 |

**CBOR positional arrays encode these original values in8 bytes without losing precision**, less than Struct's original9-byte encoding and Protobuf's12. With an8-byte OSCORE tag, this selected CBOR/CoAP uplink can also be smaller than original V2, but its tag and response/commit semantics differ. With a16-byte tag, compare the actual corresponding row instead. Field-name CBOR maps and positional CBOR have different metadata assumptions; both are retained. The evidence does not support a claim that Struct always produces the smallest payload or that every encrypted mode is security-equivalent.

## MQTT and HTTPS reference streams

MQTT rows use version5, QoS1, topic `telemetry/t`, established connection and no optional properties. HTTPS uses compact JSON, HTTP1.1 `/telemetry`, identity content encoding and an established TLS1.3 connection.

| Configuration | Payload B | Plain up/down B | Stream up/down B | Setup stream B† |
| --- | --- | --- | --- | --- |
| protobuf MQTT5 QoS1 TCP | 12 | 30/4 | 30/4 | 53 |
| protobuf MQTT5 QoS1 TLSv1.3 | 12 | 30/4 | 52/26 | 1687 |
| json-compact MQTT5 QoS1 TCP | 47 | 65/4 | 65/4 | 53 |
| json-compact MQTT5 QoS1 TLSv1.3 | 47 | 65/4 | 87/26 | 1687 |
| cbor-array MQTT5 QoS1 TCP | 8 | 26/4 | 26/4 | 53 |
| cbor-array MQTT5 QoS1 TLSv1.3 | 8 | 26/4 | 48/26 | 1687 |
| Compact JSON HTTPS TLS1.3 | 47 | 177/221 | 221/265 | 1590 |

†Setup is separately measured TLS/MQTT connection bytes, or TLS-only for HTTPS. It excludes TCP SYN/ACK and must not be added once per message on a reused connection. TLS response records and HTTP header/body writes can split differently across runs. These actual stream observations are valid for the captured run; they are not full TCP/IP or cellular totals. All corresponding network-header totals are null. Publisher subscriber-leg traffic is excluded. No stream recv chunk is counted as a TCP packet.

## Multiple sizes and batching

The following actual encodings wrap one deterministic binary field of the stated length. JSON uses an explicit hexadecimal `$bytes` convention; its cost is not ordinary numeric sensor JSON.

| Input binary B | Protobuf B | CBOR named-map B | CBOR array B | JSON tagged bytes B |
| --- | --- | --- | --- | --- |
| 1 | 3 | 9 | 3 | 25 |
| 16 | 18 | 24 | 18 | 55 |
| 64 | 66 | 73 | 67 | 151 |
| 256 | 259 | 266 | 260 | 535 |
| 1024 | 1027 | 1034 | 1028 | 2071 |
| 4096 | 4099 | 4106 | 4100 | 8215 |
| 16384 | 16388 | 16394 | 16388 | 32791 |

Current Struct does not support a native arbitrary byte-array schema, so assigning it an invented16KB encoding would be invalid. Supported float32 field-count sweeps give actual Struct sizes:

| float32 fields | Struct payload B | V2 unconfirmed app B | Estimated IPv4 uplink B |
| --- | --- | --- | --- |
| 1 | 4 | 29 | 57 |
| 2 | 8 | 33 | 61 |
| 3 | 12 | 37 | 65 |
| 5 | 20 | 45 | 73 |
| 10 | 40 | 65 | 93 |
| 20 | 80 | 105 | 133 |
| 50 | 200 | 225 | 253 |
| 100 | 400 | 425 | 453 |

Actual aiocoap high-level blockwise exchanges reassemble these payloads and verify a SHA256 response:

| Opaque input B | Application up B | Application down B | Estimated IPv4 exchange B |
| --- | --- | --- | --- |
| 1024 | 1033 | 39 | 1128 |
| 2048 | 2076 | 51 | 2239 |
| 4096 | 4148 | 69 | 4441 |
| 8192 | 8292 | 105 | 8845 |
| 16384 | 16580 | 177 | 17653 |

These exchanges include Block options and real multiple datagrams; they are not a one-header approximation for a large message. Separate low-level large datagram cases flag1500-byte-path MTU exceedance; actual IP fragmentation was not captured.

Actual native confirmed V2 batches of the original9-byte reading:

| Readings | App up B | App receipt B | Estimated exchange B | Estimated B/reading |
| --- | --- | --- | --- | --- |
| 1 | 34 | 21 | 111 | 111 |
| 2 | 44 | 21 | 121 | 60.5 |
| 5 | 71 | 21 | 148 | 29.6 |
| 10 | 116 | 21 | 193 | 19.3 |
| 25 | 251 | 21 | 328 | 13.12 |
| 50 | 476 | 21 | 553 | 11.06 |
| 100 | 926 | 21 | 1003 | 10.03 |

Repeated logical readings are not counted as independently transmitted packets. Other stacks' application-envelope and fragmentation behavior remains in the raw/configuration data.

## Impairment, performance and anomalies

Actual seeded UDP drops were injected at0/0.1/1/2/5/10%, not modeled by scaling bytes. Both directions are independently eligible for loss. CoAP high-level experiments use100 CON or1000 NON readings per rate and accelerated50ms ACK timing/max3 retransmissions; these are explicitly not production defaults. Four20-reading latency/jitter scenarios add0,10,25±5 and50±10ms one-way delays.

Struct's real client uses20 confirmed or1000 unconfirmed readings per rate,2 retries,1000ms initial retry setting and4500ms budget. Its sink receipt verifies authenticated acceptance only, not persistence. Requested1ms pacing is subject to Windows timer scheduling. The paced run recorded:

| Injected probability | Delivery | Unique readings received | Actual retried datagrams | Sender attempts unseen at sink |
| --- | --- | --- | --- | --- |
| 0 | unconfirmed | 1000/1000 | 0 | 0 |
| 0 | confirmed | 20/20 | 0 | 0 |
| 0.001 | unconfirmed | 1000/1000 | 0 | 0 |
| 0.001 | confirmed | 20/20 | 0 | 0 |
| 0.01 | unconfirmed | 993/1000 | 0 | 0 |
| 0.01 | confirmed | 20/20 | 0 | 0 |
| 0.02 | unconfirmed | 985/1000 | 0 | 0 |
| 0.02 | confirmed | 20/20 | 0 | 0 |
| 0.05 | unconfirmed | 959/1000 | 0 | 0 |
| 0.05 | confirmed | 20/20 | 0 | 0 |
| 0.1 | unconfirmed | 911/1000 | 0 | 0 |
| 0.1 | confirmed | 20/20 | 2 | 0 |

A separate unpaced run preserves host receive overload, including losses with zero injected loss where observed. Raw sender-attempt, sink-ingress and pre-send receipt-drop accounting are separate; no fabricated complete network total is assigned to that experiment. A0.1% configured rate can produce zero observed drops in a short seeded sample; that is not evidence of zero real-world loss.

Python serialization/deserialization and Java LwM2M codec timings retain20 warmups/100 samples with median/p95; compression uses30 samples. Struct host encode/decode and frame encryption/decryption including HKDF retain1000 samples. Protocol exchange, connection and repeated publish latencies are retained where instrumented. These are host/JVM measurements, not ESP32 speed or energy. Process-tree RSS/CPU sampling reports phase resource use, not per-message allocations. No MCU flash/RAM, battery life, radio-tail energy or meaningful cross-language throughput ranking is invented.

Independent validation checks unique IDs, source references, successful decode flags, received-byte sums, UDP/IP formulas, MQTT framing, and separately parses Struct/CoAP wire framing. OSCORE actually rejects altered/replayed messages; Struct C pilot and broader gateway/wire tests cover tamper and duplicate handling; same OpenSSL stack rejects wrong trust anchors and corrupted encrypted records. DTLS tamper/replay negative tests remain unimplemented, so its byte data is labeled provisional for a security-validated public comparison.

## Missing coverage and publication readiness

The retained sampled matrix is broad but intentionally incomplete. Missing work is explicit:

* Packet-captured TCP/IP segments, ACKs, SYN/FIN, retransmissions, real path fragmentation, DNS and any physical-link/cellular framing.
* LwM2M1.2; LwM2M Observe notifications, broader native time-series Send batching, alternate real object layouts, IPv6 network pilot, OSCORE/TCP/TLS transports, bootstrap, rotation and firmware management.
* DTLS1.3; large DTLS blockwise diagnosis; DTLS negative tests; DTLS loss/reconnect/CID/resumption variants.
* MQTT persistent-session recovery, broker crash/persistence semantics, client-ID length sweeps, topic aliases, more property combinations, TLS resumption, mTLS and certificate-chain variations. Persistent TCP connection is not proof of durable MQTT session recovery.
* Protobuf proto3/editions default-presence alternatives and fixed32/sfixed32/fixed64 variants; timestamp-specific well-known-type alternatives; nested/optional semantics beyond this declared library.
* OSCORE EDHOC, context-ID and KID-length sweeps, sequence boundary-focused tests, OSCORE blockwise/Observe interactions; current sequence state is retained and already varies during the actual run.
* Struct all-slot/counter-boundary sweeps, firmware counter persistence/restart behavior and alternative frame maxima; native compression and unsupported schema types are not invented.
* Whole-stack throughput/load, per-message allocation profiles, host-independent performance conclusions, physical ESP32/STM32/Zephyr runs and real power measurements.
* Exhaustive cross-product or mathematically verified pairwise sampling. Current selections are systematic boundary/representative/critical-interaction sweeps, exactly documented in each runner and test matrix.

**Ready for a public reference dataset with disclosures:** actual serialization sizes/precision, actual Struct envelopes and local gateway receipt behavior, single-exchange plain CoAP/OSCORE measurements under recorded options/state, measured MQTT/HTTP plaintext and TLS stream reference cases, and supported LwM2M codec examples. Publish source versions, response guarantees, external-schema assumptions, initialization exclusions and calculated-network labels beside each result.

**Requires further evidence before strong public claims:** complete TCP/cellular traffic savings, broad LwM2M-vs-Struct lifecycle superiority, DTLS behavior outside the validated bounds, universal performance/security/ease ratings and hardware energy/enterprise ROI. The future tool should reject unsupported combinations instead of filling missing cells with optimistic numbers. Calculation readiness is detailed in [CALCULATION-RULES.md](CALCULATION-RULES.md), with exact encoder rules separated from live-test/model requirements.

## Runtime, size and artifacts

The clean sequential execution measured **407.00 seconds (6.78 minutes)** before normalization; the recorded complete invocation including normalization/validation was approximately7 minutes on this host. Peak sampled summed process-tree RSS was **1,156,018,176 bytes (1102.5MiB)**. Shared pages can be double-counted and short-lived children missed. Downloads/installations and subsequent targeted investigation reruns are additional. Expect about7–10 minutes on this machine, with different hosts and retry outcomes changing runtime; the first installation additionally downloads a205MB JDK and other tools.

The final LwM2M network pilot was revalidated in5.59seconds after fixing the Windows log-offset contamination issue; that targeted run replaces its earlier network records and is separately recorded in runtime.json. The full-suite timing includes the earlier slower pilot. It is not presented as timing a second full run of unrelated stacks.

The compressed raw+normalized dataset is **96,162,758 bytes (91.71MiB)**; raw originals total **477,135,849 bytes (455.03MiB)**. Both copies remain locally, so disk use exceeds the compressed release size. Original raw files are gitignored to avoid duplication; their full compressed contents are versioned as checksum-verified20MiB chunks in [archive/](../archive/manifest.json). See [START-HERE.md](../START-HERE.md) for restoration. Compact normalized data and compressed CSV summaries are directly versioned. [artifacts.json](../results/summaries/artifacts.json) lists exact sizes/hashes. Raw captures are byte observations, not pcap files.

* [README and reproduction commands](../README.md)
* [Normalized NDJSON.gz](../results/normalized/records.ndjson.gz)
* [All configuration CSV.gz](../results/summaries/all.csv.gz), [reference CSV](../results/summaries/representative.csv), [payload sizes CSV.gz](../results/summaries/payload-sizes.csv.gz)
* [Coverage/counts](../results/summaries/coverage.json), [failed/unsupported report](../results/summaries/failed-unsupported.json), [wire validation](../results/summaries/wire-validation.json)
* [Schema/value library](../schemas/library.json), [test selectors](../config/test-matrix.json), [compatibility matrix](../config/compatibility.json)
* [Security matrix](../references/security-matrix.json), [implementation/license inventory](../references/implementations.json), [sources](../references/sources.json)
* [Environment](../references/environment.json), [source hashes](../references/source-hashes.json), [runtime observations](../results/raw/runtime.json)
* [Repository audit/diagnostics](REPOSITORY-AUDIT.md), [developer experience](DEVELOPER-EXPERIENCE.md), [pricing examples](../references/roi-pricing.json)

ROI research is separate from measurements: published cellular bundles, per-MB plans, minimum fees and cloud5KB message billing are recorded with dates and unknowns. No speculative customer savings were labeled measured. Extend schemas/adapters using the README's validation workflow; do not build a future calculator by looking up only these example sizes.

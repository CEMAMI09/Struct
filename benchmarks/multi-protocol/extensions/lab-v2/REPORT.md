# Protocol Lab v2 findings and completeness report

Reviewed and executed locally on October 11, 2026. Read
[ROOT-CAUSES.md](ROOT-CAUSES.md) for the pre-change investigation,
[coverage-summary.json](coverage-summary.json) for generated counts and
[README.md](README.md) to reproduce. This extension contains actual new tests,
not just proposed work. Nothing was deployed or pushed; production was untouched.

## Outcome

| Normal calculator matrix | Before | After |
|---|---:|---:|
| Protocol results checked | 1,920 | 1,920 |
| Available selected network values | 384 (20%) | 1,920 (100%) |
| Available size comparisons | 60 (3.125%) | 1,920 (100%) |
| Missing selected results | 1,536 | 0 |

**1,536 previously missing results and 1,860 additional numeric comparisons were
resolved.** Of the new comparisons, 64 previously had both values available but
were blocked by eligibility rules. There were 324 previously available results
without reductions in total; the others lacked a valid baseline. The 1,860 figure
therefore includes measurement/schema fixes as well as eligibility changes. This finite matrix covers all ten built-in presets, six protocol
columns, security On/Off, confirmed/unconfirmed, original/optimized precision,
batches 1/10 and IPv4/IPv6. The default public page shows five columns; CBOR is
optional. It is not an exhaustive cross-product of every advanced setting.

At the selected network boundary, 802 cases (41.77%) use real encoded datagrams
plus specification-based UDP/IP calculations; 1,118 (58.23%) include explicit
TCP or custom DTLS models. **None of these are claimed to be full IP packet
captures.** Comparison categories: 320 baseline/direct cases and 1,600 size
comparisons with disclosed model/security/delivery differences. This is not
1,600 newly established equivalent-security comparisons.

The separate advanced sample covers 1,140 results: **1,078 available (94.56%)**,
with 385 specification-calculated and 693 modeled; 42 genuinely unsupported and
20 missing lifecycle data. It contains 1,033 valid reductions; another 45 have
valid competitor sizes but the selected legacy Struct baseline is unsupported.

Remaining unavailable advanced results:

- 33 oversized CoAP/LwM2M UDP cases need fragmentation/blockwise accounting.
- 20 custom LwM2M fresh/periodic setup cases lack registration/DTLS lifecycle
  normalization. Steady-state results remain available when setup is excluded.
- 9 legacy V1 schema cases need newer packed types. V1 is deliberately prevented
  from pretending it can carry schemas that its decoder does not implement.

Every preset has 192/192 normal-matrix results: original and optimized ESP32,
environmental, GPS, vehicle, industrial, smart home, energy, air quality and water
meter. Preset fields were retained. Missing precision constraints were not invented.

## Why the old calculator failed

The old default asked for full IP traffic while MQTT/TLS measurements only
counted streams. LwM2M was limited to one exact original ESP32 Send observation.
One eligibility key combined measurement, security, identity, forward secrecy and
acknowledgments, suppressing valid byte arithmetic. Security Off switched Struct
to larger legacy HMAC framing and disabled batching. The packed compiler stopped
at 32-bit integers and Float32. Optimized reference matching excluded unchanged
lossless schemas; explicit fixed schemas and Float32 normalization could also
fail lookup. Results exposed thirteen technical rows by default.

The fixes distinguish real missing measurements from unsupported codecs,
calculation support, reference lookup and presentation problems. Original
measurements were not rewritten to make coverage appear better.

## New measurements and retained research

| New local runner | Successful configurations |
|---|---:|
| Paho/NanoMQ MQTT application/TCP/TLS streams | 3,780 |
| aiocoap CoAP/OSCORE UDP datagrams | 2,208 |
| Struct secure/plaintext local UDP paths | 352 |
| Total additional retained configurations | **6,340** |

All new retained rows passed; none were silently substituted for failed packets.
The Struct subset contains 176 secure and 176 plaintext cases. It persisted 968
logical readings through the real secure gateway and actual migration/RPC logic
in disposable PGlite. Raw observations preserve bytes, directions, fields, values,
precision errors, statuses, environment, versions and source hashes. The final
Struct source hashes were checked against the actual modified codec/gateway files.

Coverage includes MQTT3.1.1/5, QoS0/1/2, plaintext/TLS1.2/TLS1.3, IPv4/IPv6,
CoAP CON/NON, OSCORE CCM8/CCM16/ChaCha20-Poly1305 and batches1/10. Original broader
batch, HTTPS, DTLS, connection, compression and impairment research is preserved.
CoAP/DTLS CCM8/CCM16 is now selectable from actual matching archived measurements;
custom tokens/paths/IPv6 or unmatched encodings do not inherit unrelated values.

The combined calculator index exposes **71,359 original IDs**: 70,284 passed and
1,075 unsupported. It contains 389 schema/value entries and 162 distinct literal
field definitions, with 7,424 interned profiles. These are not 71,359 unique
schemas, packets or independently equivalent comparisons.

Approximate retained sizes: 2.59 MB compressed new raw observations, 2.43 MB
compressed extension normalized data, 3.52 MB sanitized server-only index and
9.8 MB total extension folder including coverage JSON, codec evidence and reports.
Host runtimes were about 17 seconds for competitors and 16.5 seconds for Struct;
installation, web tests, browser tests and build are separate. Repeated collection
runs regenerate this version's files; create a new extension directory for a new
experiment. Original dataset1.0.0 artifacts are unchanged.

## Struct schema and security changes

New actual capabilities: Float64; signed/unsigned widths through64 (including
8/16/32/64); wide bitsets; bounded UTF-8 and raw byte fields. Existing boolean,
Float16/Float32, enum, fixed/ranged decimal and bit-packed types remain intact.
Timestamps are uint64 milliseconds. Wide values are stored as exact tagged
decimal strings; binary as tagged hex, avoiding JSON precision loss.

The 18-field core schema was generated in both modes, compiled with actual C
serializers under Zig/WASI and checked byte-for-byte against Node. Identical
payloads passed the real authenticated local UDP/gateway/storage path on both IP
versions. Float64 `1.0000000000000002` was checked with exact equality through the
gateway; Float32 cannot preserve it. Integer extrema, UTF-8 and binary values were
verified. C capacity, finite-value, text-length and UTF-8 checks rejected invalid
inputs. Six correctly authenticated malformed text payloads were rejected before
storage. This is host/WASI testing, not physical ESP32 qualification.

Bounded text/bytes use two-byte length + declared capacity, with zero padding.
Existing numeric packets gain no overhead. The fixed allocation keeps batching
and MCU buffer bounds simple, but sparse strings may cost more than other formats.
Nested, optional/nullable, repeated/variable arrays and generic typed arrays remain
unfinished. Bounded raw bytes are not falsely called arbitrary array support.

Production Secure V2 crypto/framing remains unchanged. New schema types require
rolling out the additive decoder/compiler and publishing **unused immutable
slots**; old slots are never overwritten. Existing SQL schema-array publication
already accommodates these definitions; no migration was needed or applied.

Security Off selects isolated **SLB0 plaintext LAB ONLY**, never legacy V1 or an
unauthenticated production downgrade. Its 13-byte domain-separated header carries
control/device/sequence plus the same encoded sensor data. It has no encryption,
MAC, tag, replay protection or authenticated device identity. Its optional 9-byte
receipt acknowledges local decode only. All benchmark plaintext frames were
rejected by production parsing; all tested secure tampering was rejected. The
production gateway/SDK never imports the plaintext receiver.

Node SecureV2Client now offers explicit udp6; udp4 remains the default. A real
confirmed IPv6 SDK exchange passed. Production listener configuration and ESP32
IPv6 transport were not changed.

## Representative calculator output

Actual built-server responses are retained in [calculator-reference.json](calculator-reference.json).
Below: original sensor values, encryption On, IPv4, one reading, persistent
steady state, full exchange, global unconfirmed mode. Precision optimization is
declared and applied to every serializer; humidity becomes61.3.

| Stack | Original sensor bytes | Optimized sensor bytes | Optimized application uplink | Optimized network exchange |
|---|---:|---:|---:|---:|
| Struct Secure V2 | 9 | 3 | 28 | 56 |
| Protobuf/MQTT5/TLS1.3/QoS0 | 12 | 8 | 24 MQTT bytes | 126 modeled |
| CBOR/CoAP/OSCORE ChaCha | 8 | 8 | 41 | 122 calculated |
| LwM2M/SenML-CBOR/custom DTLS | Not separately instrumented in original native Send | 34 | 90 modeled | 196 modeled |
| Compact JSON/MQTT5/TLS1.3/QoS0 | 47 | 44 | 60 MQTT bytes | 162 modeled |
| Positional CBOR/MQTT5/TLS1.3/QoS0 | 8 | 8 | 24 MQTT bytes | 126 modeled |

MQTT application rows exclude TLS; the selected normalized application-wire and
network totals include security. Plain CBOR encodes the original values in8 bytes,
less than Struct original9. This is a serializer fact, not a complete-security
stack comparison. Full exchanges include actual selected response policies:
Struct unconfirmed has no response, CoAP/LwM2M do, and TCP adds modeled ACKs.

| Struct reference | V2 original | V2 optimized | SLB0 optimized lab |
|---|---:|---:|---:|
| Payload | 9 | 3 | 3 |
| Application uplink | 34 | 28 | 16 |
| Estimated IPv4 uplink | 62 | 56 | 44 |
| Confirmed application receipt | 21 | 21 | 9 |
| Confirmed estimated IPv4 round trip | 111 | 105 | 81 |

Secure V2 still meets the **25-byte fixed-overhead target**. The unencrypted V1
103-byte uplink baseline is not security-equivalent. Original/optimized V2 uplink
reductions versus that historical baseline are39.81%/45.63%, with the optimized
case also changing precision. The calculator discloses these dimensions rather
than turning those figures into universal security-equivalent marketing claims.

## Calculator and ROI behavior

Simple results now put total bytes and differences first, then plain security,
delivery and factual integration requirements. Advanced preserves all technical
metrics and expandable groups. View changes preserve schema/settings and do not
recalculate. An error-recovery reset discovered during browser tests was fixed.

Comparison dimensions independently show data/precision, security, delivery and
measurement. Security differences alone no longer suppress size arithmetic.
The same-boundary requirement remains. Direct vs disclosed/incomplete/unsupported
states, clickable evidence, exports and raw benchmark IDs are preserved.

TCP/IP totals use an explicit model with minimum headers, MSS segmentation,
flushed TLS records and one standalone ACK/data segment. Custom LwM2M uses a
documented CID6/GCM envelope model. Models are never called packet captures.
Forty real calculator SenML payloads were independently decoded by Leshan;
that check exposed and corrected integer-vs-floating SenML representations.

ROI applies cellular fraction and batch division once, uses decimal MB, supports
measured-baseline overrides, metered/flat billing, plan minimums and explicit
rounding. Security/delivery differences are disclosed rather than blocking valid
scenario arithmetic. Missing network boundaries still withhold financial values.
Flat-rate bills do not fall with bytes. Connection accounting and model assumptions
remain visible; no speculative customer savings or subscription pricing was added.

## Verification

- 36 calculator/archive/coverage tests pass, included in 174 passing website tests.
- 3 separately selected firmware/code-generation checks pass, including the real
  generated ESP32 firmware build. ESP32-C3 compilation remains blocked by the
  missing local `riscv32-esp-elf-g++`; its earlier attempted failure is retained
  as a limitation, not counted as successful firmware qualification.
- 18 production-build browser checks pass at desktop1440, tablet820 and mobile390:
  editing, lossiness, batch/IP/delivery, validation, security mapping, recovery,
  explanations, keyboard/overflow, ROI, export, share restore, research and views.
  Desktop/mobile screenshots were inspected; no document-width overflow.
- Secure V2 database, existing golden vectors, packed C parity, hostile parser,
  counter/bootstrap, retries, receipts, Node IPv4/IPv6, real gateway concurrency,
  batches/outbox/rotation and C/mbedTLS7-vector crypto suites pass.
- 40 independent Leshan decoder checks pass.
- Nuxt type checking, production build and `git diff --check` pass. No website
  lint script exists. Nuxt still reports bundle/circular Supabase re-export
  warnings; build success is not a replacement for deployment smoke testing.

## Remaining work and public-use limits

Actual TCP/IP packet capture was unavailable in this environment. Minimum-header
models cannot establish carrier packetization, delayed ACKs, TCP options, retransmit
traffic or radio framing. Real capture remains a future validation task.
Custom LwM2M Send/DTLS endpoint interoperability, registration/update/handshakes,
arbitrary keepalives/resumption, loss models, CoAP fragmentation/blockwise/Observe
and complex Struct schema types remain incomplete. Existing measured experiments
are still accessible in Research Explorer, not extrapolated into arbitrary totals.

The normal preset calculator is functional and ready for deployment review with
these documented limits. Publish exact encoding/datagram results and clearly
labeled scenario estimates. Do not call modeled network totals captured cellular
traffic, a percentage an equivalent-security claim, or host tests physical-device
energy/performance validation. New production schema rollout must coordinate the
gateway decoder before firmware publication; no automatic deployment occurred.

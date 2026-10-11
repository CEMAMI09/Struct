# Validated calculation rules and future settings

These are research rules, not a calculator implementation. Each rule is tied to the actual serializer, source registry, raw observations and independent validation. Unknown inputs must remain unknown rather than becoming zero-cost defaults.

## Encoding and precision

For an arbitrary schema, run the chosen real serializer with the actual values. Field names, presence, numeric values, UTF8 byte lengths, byte-array conventions, and nested/repeated structure affect size. The library covers original precision and a separate explicit fixed-point policy. All applicable competitors receive the same fixed-point transformation. The optimized ESP32 case rounds humidity 61.25 to 61.3 within the declared 0.1 step; it is not a lossless comparison with the original schema.

Struct legacy encoding uses the real generated serializer: float32 and int32 consume four bytes, uint8 and boolean one, and declared char[N] exactly N. Current packed encoding comes from `protocol/schema/bitpacked.cjs`: sum the validated field widths and round up to bytes. Range/fixed widths derive from declared representable codes. Float16 is an explicit precision choice, not a free compression feature. Native packed strings, nested structures, optional fields, repeated fields, float64 and 64-bit integers are not implemented in that codec. The benchmark's supported ASCII-string mapping to fixed char[N] is recorded in `resolved_schema_definition`; it is not native variable-length or UTF8 Struct support.

Protobuf uses actual dynamic proto2 descriptors with explicit presence. Varints, ZigZag, field numbers, lengths and repeated packed flags follow the [encoding specification](https://protobuf.dev/programming-guides/encoding/). Zero is explicitly present here. Proto3 implicit-default omission requires separate semantics and validation. uint8/uint16 map to uint32; float16 maps to float32 because Protobuf has no native half scalar. `fixed` is a shared quantized uint32 convention, not Protobuf's fixed32 wire type. True fixed32/sfixed32/fixed64 variants remain future coverage.

JSON compact/standard use Python's actual formatting and UTF8. Bytes and integers beyond JavaScript's safe integer range use the documented `$bytes`/`$integer` convention; these costs cannot be omitted. Positional JSON and CBOR arrays require shared ordering; integer-keyed CBOR requires shared key mappings. Canonical CBOR uses the shortest lossless representation accepted by cbor2. Those forms deserve comparison with Struct's external-schema model; field-name maps should also remain available. For optional positional JSON, absent is represented by a null placeholder under the selected schema; nullable-present and absent would need a distinct convention if both were allowed.

## Struct frames

The SDK and gateway measured these envelopes and the independent validator cross-checks every successful Struct row:

* Legacy authenticated plaintext: `payload + 66` application bytes. Header34 plus HMAC32. This is the user's “V1” baseline; its code identifiers are legacy protocol2/3, not Struct Secure V2.
* Legacy encrypted: `payload + 98`: the same outer envelope plus inner timestamp4, AEAD nonce12 and tag16. Receipt69 when requested. This is real supported optional encryption, not an invented V1 mode.
* Secure V2 single: `payload + 25`: control1, wire ID4, sequence4, tag16. Ciphertext length equals plaintext length. Nonce is derived; no separate transmitted nonce. There is no unencrypted V2 mode.
* V2 receipt: control1, sequence4, authentication tag16 =21 bytes; confirms the actual gateway database transaction in the main Struct/C pilot.
* Native V2 batch: count1 plus equal-size records in each frame, plus25 per frame. `splitBatch` applies the configured1200-byte maximum and255-record count limit. For requested N records of S bytes, each chunk capacity is `min(255, floor((1200-26)/S))`; each chunk adds26 overhead. A single unbatched reading adds25. Reject records that cannot fit rather than silently inventing fragmentation. One receipt is generated per confirmed frame, not per logical reading.

Sixteen schema slots are selected by control bits without increasing the header. Broader slot selection/counter-boundary experiments remain untested. Enrollment, schema distribution, root rotation and counter persistence have real lifecycle costs outside these steady-state messages. A zero in handshake_bytes means no per-exchange handshake, not cost-free provisioning.

## CoAP and OSCORE

CoAP size is exactly calculable for a fully specified encoded message: base4, token0..8, delta/length encoded options, optional payload marker1, payload. Option order, URI segments, content format, Observe and Block options all matter. See [RFC7252 sections3–5](https://www.rfc-editor.org/rfc/rfc7252). The separate validator parses headers, options and markers independently of aiocoap and compares the plaintext payload where visible.

OSCORE adds an actual inner message, AEAD tag and OSCORE outer option; it can move or remove other options. Its incremental overhead is not one universal constant. Inputs include algorithm/tag, sender KID, context ID, sequence/Partial IV length, request versus response binding and option classification. Benchmark records retain the sender sequence and exact wire message. Encode with aiocoap to get an exact answer. Requests and responses reuse the library's real request binding, and actual tamper/replay rejection is tested. [RFC8613 sections3–6,8–9](https://www.rfc-editor.org/rfc/rfc8613) explains the context requirements. EDHOC provisioning/handshakes are not tested.

NON in the low-level matrix still receives a NON2.04 application response. It is not a zero-downlink fire-and-forget configuration. CON uses piggyback2.04 ACK there. High-level blockwise/Observe and impairment experiments have their own multi-datagram exchanges. Do not reuse one-message overhead for a16KB blockwise transfer.

## MQTT and TLS streams

Given the exact MQTT version, topic, QoS, properties and payload, PUBLISH framing is exact: control byte, variable Remaining Length, topic length2 and topic, packet identifier2 for QoS>0, MQTT5 properties length/properties when applicable, then payload. QoS1 adds PUBACK; QoS2 adds PUBREC, PUBREL and PUBCOMP on the publisher leg. MQTT5 acknowledgments can use shortened encodings. Parse real bytes or follow the relevant [OASIS specification](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html). CONNECT/client ID/session settings and PING/DISCONNECT are separate traffic.

The dataset independently checks the captured plaintext MQTT stream's PUBLISH framing and payload length. TLS stream totals are actual OpenSSL record bytes, not calculated encrypted-payload sizes. Exact TLS record bytes depend on negotiated cipher, record splitting, padding, post-handshake tickets and alerts. TLS1.3 commonly has5 record-header bytes, inner content-type and AEAD tag, but multiplying one fixed increment by logical messages is invalid without knowing the number of records. TLS1.2 selected AEAD suites differ in explicit nonce framing. ServerHello cipher is parsed where retained.

Fresh/reused session experiments retain handshake, publish, idle maintenance and termination streams separately, including a measured amortized stream cost for1/2/5/10/25/50/100 readings. Connection establishment includes TLS and MQTT but excludes TCP SYN/ACK. Certificate chain, authentication method, resumption,0RTT and DNS can materially change costs and need new runs. The measured TLS endpoint authenticates the server only; MQTT clients are anonymous locally. It is not equivalent to Struct's per-device PSK identity.

[RFC9846](https://www.rfc-editor.org/info/rfc9846/) is the current backward-compatible TLS1.3 revision and obsoletes the user's starting reference RFC8446. The dataset measures negotiated TLS1.2/1.3 using its pinned libraries; it does not claim an audit of all revised RFC9846 compliance requirements.

## DTLS, HTTPS and LwM2M

Scandium DTLS1.2 PSK CCM8/CCM16 record bytes are measured at a UDP proxy. Record headers, explicit nonce/tag and CoAP messages can be parsed from those observations, but automatic fragmentation, ACK scheduling and handshake retransmissions require the actual exchange. Initialization currently includes a labeled one-byte warmup as well as the handshake; use raw record content types to separate them. Large DTLS blockwise echo tests timed out and are harness-limited, not a protocol ban. No DTLS1.3 claim is made.

The actual handshakes negotiate **6-byte connection IDs in both directions**, with record content type25, a19-byte visible header and an encrypted inner content type. This is the [DTLS1.2 CID extension](https://www.rfc-editor.org/rfc/rfc9146), not the plain13-byte record-header assumption. The analyzer parses Hello extensions, negotiated cipher and all retained record lengths; normalized records expose `dtls_connection_id_bytes`, `negotiated_dtls_cipher` and record layouts. Default CID values/cipher choices belong to these selected implementations. A future CID-disabled comparison requires a new actual run; CID migration/reconnection benefits are not measured here.

The LwM2M pilot actually negotiates `TLS_ECDHE_PSK_WITH_AES_128_GCM_SHA256` (0xD001), identified from ServerHello and the [IANA registry](https://www.iana.org/assignments/tls-parameters). This uses a16-byte GCM tag and ephemeral key exchange; [RFC8442](https://www.rfc-editor.org/rfc/rfc8442) describes that suite. Its forward-secrecy properties differ from the direct CoAP benchmark's pure PSK CCM8/CCM16 configurations. Do not flatten all DTLS PSK modes into a single security category.

HTTPS data includes actual HTTP1.1 request/response headers, JSON or gzip body and actual TLS stream. HTTP gzip is a tested stack feature; standalone gzip/zlib/Brotli serialization experiments are payload-only and do not imply native Struct, MQTT, CoAP or LwM2M compression support.

LwM2M sizes require the declared object/instance/resource model, content format, operation and transport. Leshan codecs calculate actual TLV, LwM2M JSON, SenML JSON/CBOR, text and opaque outputs. The1.1 network pilot separately measures registration, update, server Read and native Send. Read's sensor data travels device-to-server in a response; request direction is not the telemetry direction. TLV/Read must not be mislabeled as unsolicited native Send. Native Send covers SenML JSON/CBOR. Registration is an initial cost amortized over a defined lifetime/report interval, with updates separate. No LwM2M1.2, bootstrap lifecycle, firmware transfer, or LwM2M Observe network cost is inferred from these pilots.

## Network and ROI

For each observed unfragmented UDP datagram, add8 UDP plus20 IPv4 or40 IPv6 base-header bytes. These are specification calculations from [UDP](https://www.rfc-editor.org/rfc/rfc768), [IPv4](https://www.rfc-editor.org/rfc/rfc791) and [IPv6](https://www.rfc-editor.org/rfc/rfc8200). Large packets on a real1500-byte path need fragmentation/blockwise/PMTU analysis. Loopback application observations do not establish actual cellular or Ethernet packetization.

TCP/IP totals need packet capture: actual segments, TCP options, pure ACKs, setup/teardown, retransmissions and IP extensions. Those values remain null. A stream result is not suitable for an exact cellular cost claim. Impairment records retain actual attempts/drops/delivery results; loss rates are never multiplied into traffic to fabricate observations.

Future ROI inputs must include device count, readings/time, both directions, connection lifecycle, operator billing units and minimum fees. Public pricing is dated and separate.5KB cloud message billing means reducing a message from100 bytes to50 bytes may save no billed units. Bundle cost/MB is not a marginal usage charge. Report any modeled savings as scenarios and never as measured customer bills.

## Calculator setting readiness

| Settings | Readiness |
|---|---|
| Arbitrary schema/value sizes for tested JSON/CBOR/Protobuf mappings | Exact real serializer; validate unsupported types/presence/conventions |
| Current Struct supported fields, original/packed, security, batches | Exact real codec/wire functions; preserve limitations and frame maximum |
| CoAP token, URI, content format, CON/NON single exchange | Exact message encoder under declared response policy |
| OSCORE cipher, tag, IDs, sequence, option placement | Exact when context state is specified; avoid one constant overhead |
| MQTT version/QoS/topic/properties | Exact plaintext frames; chosen broker/response forms documented |
| IPv4/IPv6 unfragmented UDP overhead | Specification-calculated under explicit assumptions |
| TLS/DTLS handshake, certificate/identity, resumption, record splitting | Reference measurements; new live tests or disclosed models for variations |
| TCP/IP, path MTU, fragmentation, congestion and retry totals | Packet capture/network-specific tests required |
| Reporting frequency, reuse, keepalive, loss/jitter | Measured reference scenarios; models must remain labeled |
| LwM2M lifecycle and alternate object layouts/transports | Codecs exact for mappings; broaden network/lifecycle pilots |
| ESP32 memory, energy, hardware throughput and battery | Physical validation required |
| Cellular/cloud monetary savings | Dated operator-specific models with rounding/minimums; not exact packet-only inference |
